# Math runtime pilot

This pilot adds an incremental execution graph, uses it for the renderer's water metadata planning, and provides an optional WebGPU implementation of the existing fixed-grid water substep. The normal application continues to advance its existing CPU/WASM simulations. Its soft-kernel loader still prefers SIMD WASM, then scalar WASM, then JavaScript. The optional GPU solver is exercised explicitly by the benchmark and renderer integration harnesses; it is not selected automatically by the application.

All retained GPU measurements below use **Google SwiftShader, a software adapter**. They qualify the recorded fixtures and offscreen renderer path, without establishing hardware acceleration, canvas presentation, application FPS, operating-system improvement, or a performance consequence of a mathematical theorem. The existing SIMD default remains in place: the current production-scale solver measurement does not justify replacing it.

## Delivered components

| Component | Responsibility |
|---|---|
| [Execution graph](../src/runtime/execution-graph.ts) | Typed dependencies, dirty propagation, generation identity, input versions, resource-contract checks, and computation counters |
| [Water surface planner](../src/webgpu/water-surface-plan.ts) | Cache water uniform bytes and checked topology independently of changing simulation state |
| [Water reference](../src/soft/water-reference.ts) | CPU reference with JavaScript or explicitly rounded `f32` arithmetic; preserve both state banks |
| [GPU water solver](../src/webgpu/water-compute.ts) | Encode four ordered compute passes per substep and expose the resulting GPU buffers |
| [Renderer integration](../src/webgpu/renderer.ts) | Bind resident water buffers, retain the CPU upload path, and run optional compute before drawing |
| [Benchmark harness](../benchmarks/math-runtime/README.md) | Validate seeded cases and measure JavaScript, original scalar/SIMD WASM, GPU execution, transfers, and graph work |

The changes do not implement a general compiler, automatic backend scheduler, precision optimizer, or formal proof of the whole application. Forcing, droplets, floaters, and their coupling to the water surface remain outside the GPU pilot. Switching the coupled application to GPU authority would require additional work and evidence.

## Execution graph contracts

`ExecutionGraph` is a small synchronous, demand-driven DAG. Register inputs with `input<T>()`, computations with `node<T>()`, and publish source values with `setInput(handle, value, { generation, version })`. A node reads only declared dependencies through `context.read()`. `evaluate(handle)` recomputes dirty dependencies in deterministic order; clean targets return their cached value without traversing the graph.

| API | Contract |
|---|---|
| `setInput()` | Version is a nonnegative safe integer and cannot decrease within a generation. The generation must equal the graph's current identity. |
| `setGeneration(identity)` | Clear publications and input readiness. A retired identity cannot be reused. Publish inputs again for the new lifetime. |
| `invalidate(handle)` | Mark affected computations dirty after an explicit external change. Descendants are invalidated; unrelated nodes remain cached. |
| `invalidate()` | Mark all computed nodes dirty without changing the scene generation. |
| `resource()` and node `reads`/`writes` | Declare whole-resource effects. Conflicting accesses require dependency ordering; shared read-only access is allowed. |
| `stats()` / `resetStats()` | Inspect or reset counters for source updates, invalidations, computations, cache hits, failures, and generations. |

An in-place input mutation must advance its version or explicitly invalidate its input. Changing an object identity also invalidates its consumers. All aliases of one resource must use the same resource handle: the graph cannot discover arbitrary aliasing in external buffers.

Optional value contracts describe shape, units, and precision. Shape checks validate flat array length; metadata checks reject declared unit or precision mismatches. Resource checks compare declared buffer size, texture format, dimensions, and sample count. These are executable interface contracts, not evidence that a callback computes in the declared units, uses a particular arithmetic precision, supports a GPU format, or satisfies a numerical error bound. WebGPU validation and device capability checks remain necessary.

A failing callback or output shape check does not publish a new value. The node remains dirty and can be retried. Callbacks must be synchronous; graph mutation, nested evaluation, undeclared reads, and promises are rejected. Keep callbacks pure or stage external effects: the graph cannot undo a GPU write, file write, or other side effect that a callback performed before throwing. It does not track asynchronous GPU completion.

## Water metadata planning and renderer handoff

`WaterSurfacePlanner.resolve(description)` returns a `WaterSurfacePlan` containing 64 uniform bytes, the active triangle index count, and the maximum active index. Layout changes update the packed parameters. Index identity, count, vertex count, or topology version changes recheck topology. Advancing `frameVersion` alone does neither, so ordinary water steps do not repeatedly scan an unchanged index array.

The renderer calls the planner on its existing CPU-backed `gpu-water` path and in `uploadResidentWater()`. The latter requires buffers from the renderer's device, with `STORAGE` usage and sufficient size for every grid cell. It binds the solver's `eta`, `u`, and `v` directly. It does not transfer ownership of those buffers. The CPU path remains available and rejects incomplete or non-`Float32Array` water fields.

The planner rejects malformed grid dimensions, invalid active triangle counts, non-`Uint16Array` indices, out-of-range indices, and extents that are nonfinite or become zero/overflow in `f32`. The renderer capacity is 16,384 vertices and 98,304 active indices. The optional solver requires at least three rows and three columns and separately checks device storage/dispatch limits. The 256 × 256 and 512 × 512 solver benchmarks exceed the current renderer's vertex capacity; those cases measure solver scaling only.

Treat returned parameter bytes and index data as borrowed immutable data while their versions remain unchanged. `renderer.invalidateDynamicCaches()` starts a new planner generation and clears resident parameter/binding caches. Call it at scene/device lifetime boundaries, including a transition to a newly created pilot solver. A late asynchronous result from a retired scene must still be rejected by the application using its own scene token; invalidating the planner does not identify the provenance of arbitrary external objects.

### Correct integration order

Create the optional solver with the renderer's existing device:

```ts
const solver = await GpuWaterCompute.create(
  renderer.device,
  { cols: metadata.cols, rows: metadata.rows },
  initialFields,
  destinationHistory,
);
// Check the application's scene token after the await before adopting this solver.
renderer.invalidateDynamicCaches();
```

`metadata` is a valid `WaterSurfaceDescription`; `initialFields` and `destinationHistory` each contain three `Float32Array`s matching its grid. Omitted initial fields or history are initialized to zero. Existing scene uniforms, instance uploads, camera updates, and other rendering setup remain the caller's responsibility.

Encode each substep **before** selecting `currentBuffers`, then bind and draw in the same encoder:

```ts
renderer.render(instanceCount, debugLines, lineFrameVersion, (encoder) => {
  for (let step = 0; step < substeps; step++) {
    solver.encodeStep(encoder, params);
  }

  renderer.uploadResidentWater(
    { ...metadata, frameVersion: solver.steps },
    { device: renderer.device, ...solver.currentBuffers },
  );
});
```

Here `params` is `WaterStepParams` and `substeps` is the application's validated nonnegative integer count. The renderer invokes the callback before its render passes and submits the finished encoder. Selecting buffers before `encodeStep()` would select the old ping-pong bank on an odd number of substeps. Do not submit the encoder inside this callback. Do not follow the resident binding with `uploadSurface()` for the same frame, because that method deliberately restores the CPU-backed water bindings.

`render()` can return early when render targets are unavailable; in that case the callback does not run. Track actual encoded steps rather than assuming that every requested frame advanced the solver. The existing application does not call this optional solver automatically. The [render parity harness](../benchmarks/math-runtime/render-parity.mjs) shows the explicit integration path.

## Solver state, ownership, and error handling

| API | Behavior |
|---|---|
| `GpuWaterCompute.create(device, grid, initial?, history?)` | Validate dimensions, fields, and capabilities; create the solver on a caller-owned device. Initial and history arrays are copied. |
| `encodeStep(encoder, params, timestamps?)` | Record the four passes, advance encoded parity and step count, and return without submitting or waiting. |
| `currentBuffers` | Borrow the three GPU buffers that the encoded work will produce. Access this after encoding the desired substeps. |
| `steps` | Number of encoded substeps, not a completion or success acknowledgement. |
| `readback()` | Submit a diagnostic copy and return deep-copied current and destination fields plus the encoded step count. Submit all previous encoders first. |
| `reset(initial?, history?)` | Upload both banks and reset encoded parity and step count to zero. Submit prior encoded work first; queue order then sequences these writes. |
| `destroy()` | Idempotently release solver-owned state, uniform, and staging buffers. It does not destroy the shared device or caller-owned query sets. |

The owner must serialize its timeline: do not encode competing command streams against the same solver. Retain its buffers until submitted draws have finished using them. Stop encoding new work before teardown, await completion of submitted work when appropriate, then destroy the solver. A pending creation result for an obsolete scene must be discarded and destroyed instead of being installed into the current scene.

Handle synchronous exceptions, WebGPU validation errors, and device loss at the owning application boundary. If encoding is abandoned or submission fails after parity advances, stop using that encoded state and reset from a known-good checkpoint or recreate the solver. Device loss requires resources on a replacement device. The graph and solver do not roll back a partially encoded frame. Lazy parameter allocation is synchronous, so asynchronous GPU errors also require the owner's error handling.

Faithful checkpoints contain **both** banks. Restoring only current `eta/u/v` changes subsequent boundary-adjacent updates. `reset(snapshot.current, snapshot.destination)` restores their data but sets the solver's local step count to zero; restore any application simulation clock separately. Readback is intended for diagnostics/checkpoints, not a required per-frame transfer.

Parameters include `dt`, gravity, mean depth, drag, and inverse grid spacings. Finite values, signs, and coefficient overflow are checked; these checks do not establish a stable timestep or bound all future states. The owner still chooses the physical timestep and substeps. The implementation caches at most 256 distinct packed parameter sets per solver, keeping each uniform buffer immutable so differently parameterized steps can share one submission safely. Recreate the fixed-step pilot when changing to a schedule that exceeds this bound.

Timestamp recording is optional. It requires the device's `timestamp-query` feature and a timestamp query set with valid distinct begin/end indices when both are supplied. The owner resolves and reads the queries. Timestamp availability is independent of whether ordinary compute can run.

## Four-pass boundary and history semantics

The reference and WGSL retain the existing production substep's ordering and destination-buffer history:

| Pass | Writes and dependencies |
|---|---|
| 1. Interior velocities | Write destination `u/v` from current height gradients and damped current velocities. Leave destination boundaries untouched. |
| 2. Interior heights | Write destination height from destination velocity differences, then clamp height to `[-1.65, 1.65]`. Boundary neighbours still contain destination history at this point. |
| 3. Boundary rows | Update top/bottom height and velocities from their adjacent rows, using the existing damping/reflection factors. |
| 4. Boundary columns | Update left/right columns after row updates. This phase owns the final corner values. Swap current/destination roles after encoding. |

These are separate compute passes because dependencies span workgroups. A workgroup-local barrier cannot establish the required global ordering in a single dispatch. Refreshing destination boundaries early, zeroing them each step, or merging row/column corner writes without a specified owner would change the numerical update. The pilot preserves these semantics; it does not replace them with a new physical boundary condition.

The CPU reference offers `javascript` arithmetic and an `f32` diagnostic mode that rounds elementary operations. GPU arithmetic may differ within the benchmark tolerance. Finite seeded comparisons and coefficient checks do not constitute an all-input equivalence proof, a stability proof, or calibration of the physical model.


## Fresh evidence and validation

A workspace interruption lost the original raw timing files. The project and harness were restored, and the incremental graph was functionally reconstructed with a new hash. **The four retained reports below are fresh runs and replace the lost raw evidence.** Old samples were not synthesized. Every source hash recorded in these reports matched the corresponding delivered file at document freeze.

| Raw report | Created on 2026-10-31, UTC | Scope and outcome |
|---|---|---|
| [Node CPU](../benchmarks/math-runtime/results/node-cpu.json) | 20:53:44.611 | Node v24.22.1 on Intel Xeon Platinum 8573C; JavaScript/scalar/SIMD measured; no GPU device in this runner |
| [Software browser](../benchmarks/math-runtime/results/browser-software.json) | 20:54:18.283 | Chromium 141.0.7390.37; explicit SwiftShader fallback; all four backends measured |
| [Offscreen renderer and upload overhead](../benchmarks/math-runtime/results/render-parity-offscreen-software.json) | 20:55:02.165 | Software-adapter resident rendering, malformed-input rejection, and actual original/current upload comparison passed |
| [Ordinary browser](../benchmarks/math-runtime/results/browser-default.json) | 20:55:21.129 | CPU backends measured; WebGPU blocked because the ordinary adapter request returned null |

The restored project passed the locked dependency installation, **79 reported test cases/suite checks**, and the production build with **Vite 8.1.3**. Typechecking and test compilation used the locked **TypeScript 5.9.3**. The new graph and water-planner suites each passed ten tests. Their sources are [execution graph tests](../tests/execution-graph.test.ts), [water reference tests](../tests/water-reference.test.ts), and [planner tests](../tests/water-surface-plan.test.ts). The earlier missing-cache build limitation no longer applies.

The source manifest was regenerated from the complete release file set and **passed verification against a clean export**. This also repairs the baseline manifest's missing entries and stale hashes. The new graph, reference, and planner tests are included in the existing test and deployment workflows.

The isolated Node renderer test and historical benchmark loaders now emit the renderer's relative runtime dependency tree, including the water planner and execution graph. Their former two-file extraction did not cover these new imports. Archive comparisons retain their selected source root and source overrides. This test-packaging change leaves the runtime sources recorded in the four retained benchmark reports unchanged.

The existing renderer test also had a cache fixture that changed topology version from 2 to 1 while expecting the index upload to remain cached. The original renderer reproduced the same failing byte-count assertion. Cloth and water now retain the already-published topology version 2; the exact upload-byte assertions are unchanged. Historical benchmark workload guards remain intact: module-import smoke checks do not requalify their old Metal timing results or repair unrelated archive-transform mismatches.

The KTX2 test now distinguishes Dawn's `null` backend from a backend that executes shaders: it retains upload, pipeline, dispatch, copy, mapping, and validation checks, but reports numerical sampling as `NOT_EXECUTED` with `null` samples. All normalization and compressed/uncompressed sample-comparison assertions remain enabled for executing backends. This prevents validation-only output from being presented as texture-sampling evidence. The browser SwiftShader reports above separately contain executed numerical and pixel comparisons.

After these test-infrastructure updates, `npm run test:webgpu` passed in full on Node 24.22.1 with the locked dependencies: Dawn pipeline validation, the actual renderer runtime, and KTX2 validation. This local Dawn run uses the `null` backend; it does not add hardware or numerical texture-sampling qualification.

### Additional release checks and the remaining archive gate

The existing [soft-simulation soak](../scripts/soft-simulation-soak.cjs) still expected 31 material recipes, although the original v1.20 catalogue already contains 34 (13 metal, 10 glass, 10 concrete, and one combined). Its exact preflight/postflight counts and stale comment were corrected. Simulation, finiteness, topology, telemetry, damage monotonicity, deterministic replay, and coverage assertions were preserved.

`npm run test:soft-soak:all` passed with JavaScript, WASM SIMD, and WASM scalar. Each backend covered 200 stable scenes (50 each of cloth, rope, water, and fracture), all 34 derived material demos, 4,800 catalogue frames, 816 derived frames, and 3,000 deterministic replay frames. The separate native-WASM gate passed 800 scenes and 800 deterministic replays, including stream revisions and invalid-time-step rejection. These qualify the tested existing application backends; the optional GPU solver's coupled forcing, floater, and droplet behavior remains outside this pilot.

The unchanged [rope-batching archive gate](../scripts/rope-batching-qualification.mjs) failed its exact current-versus-v1.9 position comparison at stress 2, scene 650, frame 0. All ten source files in its runtime dependency closure and its five qualification inputs (gate script, archive, SIMD WASM, and both TypeScript configurations) are byte-identical to the original pinned main commit. The pilot adds no module to that runtime dependency closure. The comparison guard and archived workload remain intact. **The full release gate is therefore not qualified**, even though the new pilot's numerical, rendering, and integration checks pass.

The separate 100-case material qualification passed its full 180-frame, three-sample settings, including finite-state, determinism, and monotonicity assertions. Both the production and Pages builds passed with Vite 8.1.3 before the dependency patch described below; the build reports a large-chunk advisory. These successful checks do not waive the failed rope archive comparison.

### Build dependency patches

The dependency audit found advisories affecting the original locked Vite 8.1.3 and source-map-js 1.2.1. The final lock updates only those two resolved versions: Vite is exact-pinned to **8.1.6**, and the existing transitive source-map-js dependency is **1.2.2**. These are compatible patched releases on the existing lines; see the [Vite release](https://github.com/vitejs/vite/releases/tag/v8.1.6), [Vite patch advisory](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), and [source-map-js release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2). No packages were added or removed. TypeScript remains 5.9.3.

The exact updated `npm ci`, `npm audit --audit-level=moderate`, `npm run test:ktx2`, `npm run build`, and `npm run build:pages` all passed. The final audit reported **zero vulnerabilities at every severity**. KTX2 validation exercised the patched Vite localhost server, correct asset MIME types, all five parser-rejection checks, and a clean validation error stream. Both final builds used Vite 8.1.6 and reported the large-chunk advisory.

The retained timings predate this build-tool update. Their CPU runner imports TypeScript directly, and their browser runner uses the standalone Node server with `stripTypeScriptTypes`; neither uses Vite to serve or compile measured modules. The four raw reports do not hash the package files or Vite. All **76 protected production-source, math-runtime harness/result, and WASM files** remained byte-identical, as did TypeScript's implementation and Vite's client/import-meta declarations. The benchmark timings were not rerun or rewritten. The dependency-audit blocker is resolved; the rope archive gate remains unqualified.

## Browser solver measurements

The [software browser report](../benchmarks/math-runtime/results/browser-software.json) records **140/140 passing main comparisons** and **15/15 passing additional conformance comparisons**. Original scalar WASM, SIMD WASM, and WebGPU matched the elementary-`f32` reference exactly at every recorded checkpoint, including both retained banks. The largest absolute difference against JavaScript arithmetic was approximately `6.035e-7`. These are finite fixture results, not an all-input equivalence or stability proof.

The numerical acceptance rule is `abs(error) <= 0.00002 + 0.0002 * abs(reference)`. Production-scale grids were checked after 1, 2, 8, 64, 256, and 1024 steps; larger grids after 1, 2, 8, and 64. Additional 3 × 3, 3 × 9, and 9 × 3 cases checked distinct parameter sets in one encoder and reset/replay with nonzero destination history. No uncaptured GPU validation errors were recorded.

Timing uses five warmup batches and 21 measured batches. The two smaller grids use 16 steps per batch; the larger grids use four. Every backend receives the same parameters within a case. Physical width/depth remain 34/24 while the larger-grid timestep decreases with grid spacing, so cross-grid costs per step are not costs for equal simulated physical time.

### Completion time

Each cell is **p50 / p95 milliseconds per step**, rounded from the raw report. CPU timing includes the kernel call and bank swap. GPU wall completion includes encoding, submission, and waiting for the submitted batch. Allocation, initialization, state reset/upload, readback, rendering, forcing, droplets, and floaters are excluded.

| Grid | JavaScript reference | Original scalar WASM | Original SIMD WASM | Software WebGPU wall completion |
|---|---:|---:|---:|---:|
| 48 × 40 | 0.027188 / 0.060000 | 0.009688 / 0.025625 | 0.005313 / 0.026250 | 1.349375 / 1.552813 |
| 96 × 80 | 0.070313 / 0.100000 | 0.034687 / 0.078750 | 0.015937 / 0.026563 | 0.728438 / 0.908750 |
| 256 × 256 | 0.678750 / 0.866250 | 0.331250 / 1.671250 | 0.178750 / 0.306250 | 3.422500 / 4.312500 |
| 512 × 512 | 2.598750 / 3.071250 | 1.100000 / 1.355000 | 0.622500 / 0.840000 | 11.232500 / 36.860000 |

At 96 × 80, the synchronized software-GPU median is approximately **45.7 times the SIMD median**. This run establishes no hardware crossover and supports retaining the SIMD default. The shared environment exhibits scheduling variation and outliers, including nonmonotonic small-grid timings. The raw samples and p95/p99 values matter; these small-sample percentiles are not confidence bounds.

GPU diagnostic medians distinguish submitting from finishing work:

| Grid | CPU encoding + submit, ms/step | GPU timestamp, ms/step |
|---|---:|---:|
| 48 × 40 | 0.0184375 | 1.222143 |
| 96 × 80 | 0.0140625 | 0.617165 |
| 256 × 256 | 0.0237500 | 3.158590 |
| 512 × 512 | 0.0325000 | 10.814513 |

Timestamps span the first velocity pass through the final column-boundary pass and exclude CPU work and queue waiting before that interval. Query resolution is outside the timed completion region. GPU timestamps cannot replace wall completion in an end-to-end speed claim.

### Diagnostic transfers

Seven samples per case measured full six-field reset and readback operations, separately from the resident kernel timings. Medians below include both current and destination banks; they are not per-frame traffic of the normal renderer.

| Grid | Bytes per complete two-bank state | Reset upload wall time, ms | Full readback wall time, ms |
|---|---:|---:|---:|
| 48 × 40 | 46,080 | 0.405 | 0.470 |
| 96 × 80 | 184,320 | 0.585 | 1.885 |
| 256 × 256 | 1,572,864 | 2.410 | 4.505 |
| 512 × 512 | 6,291,456 | 51.170 | 41.190 |

The 96 × 80 CPU renderer uploads three current fields, or **92,160 dynamic state bytes**, when the frame changes. Resident rendering avoids those field uploads, but still performs compute and drawing. Avoiding transferred bytes alone does not establish a frame-time improvement.

## Synthetic execution graph comparison

The [software browser result](../benchmarks/math-runtime/results/browser-software.json) also measures bounds/checksum work over 65,536 vertices and a camera-dependent derived value. Eight untimed full-vector checks, final exact values, and accumulated checksums validate the graph against the eager reference. Each measured batch contains 16 evaluations.

| Scenario | Graph p50 / p95, ms/evaluation | Eager p50 / p95, ms/evaluation | Graph nodes recomputed in measured batches |
|---|---:|---:|---:|
| Unchanged inputs | 0.0012500 / 0.0081250 | 5.5103125 / 6.4465625 | 0 |
| Camera-only change | 0.0065625 / 0.0437500 | 4.0559375 / 5.6950000 | 336 |
| Geometry change | 0.9168750 / 1.4212500 | 0.8531250 / 1.5703125 | 672 |

The first two scenarios demonstrate skipped work against deliberately eager calculation. They do not measure gains over Box3D's existing caches. When geometry changed, the graph median was higher than the eager median in this run. Runtime variation also makes absolute costs across these scenarios unsuitable as universal constants. Use the actual renderer comparison below to assess this delivered integration; do not advertise the synthetic cache-hit ratios as an application speedup.

## Offscreen renderer qualification

The [fresh renderer report](../benchmarks/math-runtime/results/render-parity-offscreen-software.json) passed through the real renderer at **320 × 240**, using the 96 × 80 fixture, its canvas texture format, and sample count 1. The final post-pass target was an owned offscreen texture. Compute, updated parity selection, resident binding, and drawing occurred in one encoder.

The harness read back GPU-produced fields and rendered those identical fields through the CPU-upload path. This separates binding/ordering correctness from cross-backend arithmetic differences. Both outputs contained visible water and matched exactly:

| Encoded water steps | Compared pixels | Water coverage pixels | Differing pixels | Differing channels |
|---|---:|---:|---:|---:|
| 0 | 76,800 | 15,116 | 0 | 0 |
| 1 | 76,800 | 15,107 | 0 | 0 |
| 4 | 76,800 | 15,108 | 0 | 0 |

The state comparisons also passed. A short height array with prefix-only indices and a non-`Float32Array` velocity field each rejected successfully, returned zero reported upload bytes, and rendered exactly the background-only reference. Alternating CPU/resident paths exercised the restoration of bindings.

The restored canonical materials loaded as **BC4 noise (`ktx2-bc4`)** and **ASTC atlas (`poliigon-astc`)**. The report records no procedural fallback, missing-texture 404, console/page error, or uncaptured GPU validation error. These are the current results; earlier fallback-material observations do not describe this run.

**Hardware acceleration, canvas presentation, and full-application FPS remain unqualified.** Offscreen equality exercises the rendering pipelines and resident handoff, but it does not establish successful presentation to the browser canvas or complete interactive application behavior.

### Actual original/current CPU upload overhead

The same report compares the [pinned original `uploadSurface()`](https://github.com/nathansenn/box3d-WEBGPU/blob/dfedd9fe9983200f492d686488d27b6a4b11c650/src/webgpu/renderer.ts) with the current method on the same initialized renderer resources. Five warmup batches and 21 samples alternate timing order; batches contain 1,024 unchanged-frame calls or 16 advancing-frame calls. Initialization, cache seeding, queue draining, simulation, draws, and GPU completion are outside this CPU timing.

| Case | Original p50, ms/call | Current p50, ms/call | Observed added CPU time, ms/call | Dynamic bytes per call, both paths |
|---|---:|---:|---:|---:|
| Unchanged frame | 0.000517578 | 0.000644531 | 0.000126953 | 0 |
| Advancing frame | 0.006562500 | 0.007187500 | 0.000625000 | 92,160 |

No metadata nodes were recomputed in the measured steady-state batches. The observed median overhead was approximately **0.000127 ms** for unchanged calls and **0.000625 ms** for advancing calls. These are batch-averaged observations from one variable environment. **No CPU upload speedup was measured.** The reliable behavior and optional resident path should be evaluated with this cost visible.

`uploadSurface()` and `uploadResidentWater()` have different historical accounting for initial uniforms and index padding. Their first-frame counters are not exact comparable traffic totals. The overhead comparison uses steady-state dynamic-field bytes only. The parity test alternates CPU and resident bindings, which can also force shared-uniform refreshes; its counters are not a whole-application bandwidth measurement.

## Reproduction and remaining gates

The [benchmark README](../benchmarks/math-runtime/README.md) documents sample settings, original WASM hashes, the pinned renderer fixture, Node/browser requirements, explicit software-adapter execution, and raw result interpretation. The [package scripts](../package.json) include:

```sh
npm ci
npm run typecheck
npm run test:math-runtime
npm run build
npm run bench:math-runtime
npm run bench:math-runtime:serve
```

The dependency-free harness server requires Node 24 or later. Keep Node, ordinary-browser, software-fallback, and hardware results separate. `COMPLETED` means available implementations completed; inspect `comparisonCoverage` for missing backends. The ordinary-browser report explicitly retains the unavailable GPU as `BLOCKED`.

Re-run after measured source changes and retain raw JSON with every performance claim. Enabling GPU simulation by default still requires target-hardware measurement, forcing/droplet/floater coupling and lifecycle work, successful presentation, and representative full-scene frame-time tests. The current implementation retains CPU/SIMD authority and the existing native WebGPU renderer.
