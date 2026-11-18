# Engine benchmark evidence

The Studio harness below measures the actual `FailureSimulation` CPU path and preserves the inputs needed to audit a comparison. It does not establish browser frame time, interactive capacity, engineering accuracy, or an engine-wide multiplier. A separate GPU-water step/upload/render harness now exists; its contract and results are described in [current progress](ENGINE_100X_PROGRESS.md) and [the GPU water API](GPU_WATER_API.md). Do not combine the two experiments into one multiplier.

The original source archive and `benchmarks/results/engine-100x/baseline-manifest.json` remain frozen. Every invocation requires a **new, nonexistent output directory**. Existing output, including an empty directory or a symlink, is rejected. Failed attempts retain a `failure.json` and their available inputs; retry into a new directory.

## Commands

Use Node 24 or newer with native TypeScript stripping. The current development runtime is Node 26. Run the CLI directly without profiling flags or `NODE_OPTIONS`; capture and measurement require identical runtime identities. No server, browser, dependency installation, or network listener is needed.

```sh
# Optional standalone source/provenance capture. Assets are hashed, never copied.
node scripts/engine-baseline.mjs \
  --root /absolute/path/to/source \
  --assets-root /absolute/path/to/shared/public \
  --out /absolute/path/to/new-capture

# Paired comparison. Both roots must contain src/studio/physics.ts.
node scripts/engine-benchmark.mjs \
  --baseline-root /absolute/path/to/extracted-frozen-source \
  --candidate-root /absolute/path/to/current-source \
  --assets-root /absolute/path/to/shared/public \
  --out /absolute/path/to/new-run \
  --trials 6 --warmup 60 --steps 120 \
  --instances 1,2,4 --studies canopy,plate,bridge --seed 100

# Rehash retained source/artifact/harness files and referenced assets, then gate.
node scripts/engine-check.mjs --run /absolute/path/to/new-run

# Require a demonstrated minimum gain instead of only no regression.
node scripts/engine-check.mjs --run /absolute/path/to/new-run --minimum-speedup 1.1

# Tests include a real eight-child CLI run and intentional evidence corruption.
node --test tests/engine/harness.test.mjs
```

For a shorter integration smoke, use `--trials 4 --warmup 24 --steps 48`. A smoke is not a final performance qualification. The default capacity sweep covers all three studies at 1, 2, and 4 independent instances. Restrict it with `--studies bridge --instances 1` when testing the harness itself; the result records the reduced coverage.

To use the source-only archive, extract it into a new small temporary directory after verifying its SHA-256 against the existing frozen manifest. Verify each extracted file against that manifest as well. Point `--assets-root` at the shared checkout's `public/` directory because the archive intentionally omitted assets. The benchmark retains its own small source snapshots, so the temporary extraction can be removed after successful verification; retain the original archive, frozen manifest, and run evidence. Do not copy `node_modules` or large assets into the extraction.

## What a run contains

| File | Evidence |
| --- | --- |
| `baseline/manifest.json`, `candidate/manifest.json` | Individual source, runtime input, and asset SHA-256 inventories; Node executable hash/version; observed OS, CPU, architecture, and RAM; Git HEAD when available |
| `baseline/source/`, `candidate/source/` | Small isolated source snapshots used by the child processes; originals are never imported while timing |
| `harness/` | Exact three scripts used for the run, with their combined identity |
| `protocol.json` | Scope, studies, instance counts, input settings, timestep, seed, warmup, sample counts, controls, timing boundaries, and limits |
| `tasks/`, `raw/` | Per-process task contracts and raw cycle measurements, output hashes, control timings, and process identities |
| `result.json` | Versioned complete result, identity links, paired execution order, raw samples, and bounded CPU capacity points |
| `gate.json` | Initial integrity-checked verdict, statistics, thresholds, and exclusions; rerun the checker to verify current retained files |

The manifest's `artifacts` inventory identifies the TypeScript source inputs that Node strips in memory. It does **not** assert that a Vite bundle or WASM binary was built or executed. Asset identity covers the referenced `public/` bytes for provenance; these assets are not used by the CPU workload. The checker requires a measured, matching asset inventory for a qualified paired run. A standalone source capture may instead report unavailable assets explicitly.

After an asset upgrade, `engine-check.mjs --assets-root EXACT_ARCHIVE` can resolve the original assets at a new location. It still requires the complete inventory to match the immutable captured hash; changing, adding or omitting a file fails verification. Source, raw-result, harness and performance gates are unchanged. Tests exercise changed live assets, a correct archive, a corrupted archive and source tampering.

The native-world artifact upgrade preserved two exact asset inventories:

- `benchmarks/baselines/public-before-native-worlds-20260910/`: 74 files, inventory `af212a9010fed93753ef7f4c2de7f0d9d74ae8b3fe43f5dc03385cb09fc4961b`, for both packed Studio timing runs.
- `benchmarks/baselines/public-studio-cpu-20260910/`: the 73 original files, inventory `c71d608651b44eb3e0e1aaa1f7eba02e33704d5f259a40f7cba1bbb0eb3c793d`, for the earlier Studio CPU comparison. The subsequently added hall panorama is absent from this exact historical inventory.

```sh
node scripts/engine-check.mjs \
  --run benchmarks/results/engine-100x/runs/studio-typed-arrays-20260910-02 \
  --assets-root benchmarks/baselines/public-before-native-worlds-20260910

node scripts/engine-check.mjs \
  --run benchmarks/results/engine-100x/runs/studio-cpu-optimized-20260910-03 \
  --assets-root benchmarks/baselines/public-studio-cpu-20260910
```

These rechecks retain the packed candidate's failed timing verdict and the earlier CPU run's inconclusive control verdict. Relocating exact assets does not turn a failed or inconclusive benchmark into a gain.

Runtime, hardware, browser, GPU, renderer, thermal state, and power mode use explicit measured/unavailable records. The observed OS/CPU/RAM fields do not imply a measured GPU model or thermal stability. SHA-256 files are local integrity receipts, not signed attestations against a malicious author replacing the entire receipt.

## Measurement contract

Each trial launches two fresh processes. Order alternates baseline/candidate then candidate/baseline, requiring an even number of trials. Case ordering is seeded and identical within a pair. Each case warms the same stepping, snapshot, and topology calls, then constructs fresh instances for measurement. Constructor/import/TypeScript-strip time is excluded and labelled as such.

Each timed CPU cycle steps all independent instances once at `1/120 s`, captures immutable snapshots, and obtains active indices. The result stores every measured cycle in milliseconds:

| Metric | Boundary |
| --- | --- |
| `stepMs` | Sum of the instances' `step()` calls |
| `snapshotMs` | Sum of the instances' `snapshot()` calls |
| `topologyMs` | Sum of the instances' `activeIndices()` calls |
| `cpuCycleMs` | All of the above calls and loop/timing instrumentation for one complete CPU cycle |

Checksums, finite-state checks, anchor checks, constructors, and imports are outside the CPU cycle timer. Resource observations include that untimed work and therefore are not allocation-per-operation measurements. Typed snapshot byte counts cover the typed arrays only. The full browser/GPU frame remains unavailable. Stage wins are never multiplied or presented as end-to-end frame gains.

The numerical contract is exact: initial and every measured cycle's position/strain/broken buffers, response and press telemetry, active indices, and final events must hash identically across trials and revisions. Current settings and actual node/link/face counts must match. A different mesh size, load, normalized press setting, timestep, or output hash cannot qualify as an equal-quality speed gain. Private solver iteration count is unavailable; exact output preservation qualifies only this tested reduced-model path and horizon. It does not establish convergence, calibrated physical accuracy, long-horizon correctness, or a new solver mode's equivalence.

The unchanged integer control uses the same retained harness code, seed, and iteration count in every process. Eight timings occur before and eight after each workload suite, after a separate control warmup. A control drift can invalidate timing evidence even when the candidate itself looks faster.

## Statistics and gate

Every stage reports raw-cycle median/p95 and the median/p95 of per-process means. The confidence interval uses 2,000 deterministic paired bootstrap resamples of process means and the ratio of their medians. Pair indices are resampled together, respecting the adjacent AB/BA experiment. Raw-cycle p95 describes this finite sample, not an estimated browser-frame percentile. Six process pairs are a bounded development experiment; collect a larger declared campaign for narrow confidence intervals.

The primary no-regression gate uses complete `cpuCycleMs`, a default 5% timing tolerance, the candidate's measured cycle p95, exact numerical output, and unchanged controls. The unchanged-control tolerance is 15%; a confidence interval crossing the control tolerance is inconclusive. Stage regressions remain visible even when combined CPU time passes. `--minimum-speedup` additionally requires the lower 95% CPU-cycle ratio bound to meet the requested gain for every tested case.

| Verdict | Meaning | Exit |
| --- | --- | ---: |
| `pass` | The recorded CPU comparison satisfies the chosen thresholds and identity/quality checks; each stage separately states whether its lower confidence bound demonstrates a speedup | 0 |
| `fail` | Measured CPU/control regression, tail regression, or deterministic output drift | 1 |
| `incomparable` | Missing measurements, damaged evidence, mismatched environment/assets/scope/settings/workload, or invalid pairing | 1 |
| `inconclusive` | Confidence intervals cannot qualify the declared threshold | 2 |

`pass` at equal performance is a no-regression result, not a speedup. No measured samples, unknown values, or missing controls are never silently accepted. Threshold changes are explicit CLI arguments and appear in the returned verdict. Do not tune thresholds after seeing a failure to recast the same run as success.

## Capacity and bounds

Studio does not publicly configure mesh dimensions or solver iterations. The sweep therefore increases **independent instances**, recording actual aggregate node/link/face counts, while retaining each authored mesh and numerical settings. Each sample is compared with a declared CPU-cycle budget, defaulting to `1000/120 ms`; change it explicitly with `--cpu-budget-ms`. Passing a sampled point does not establish the largest supported workload, rendering capacity, or interactive frame rate.

Limits are enforced before execution: 4–20 even-numbered paired trials; 1–600 warmup steps; 2–600 measured steps; only 1/2/4 instances and the three existing studies; at most 200,000 aggregate simulation steps and a 12 MiB estimate for raw numbers. Each child is limited to 45 seconds and 4 MiB stdout; the run defaults to 300 seconds with an allowed 30–600 second `--wall-seconds` bound. Source and asset inventories cap at 64 MiB and 512 MiB respectively, with 10,000 files per inventory. Source is copied twice for the pair; assets and dependencies are never copied. Symlinked source/asset entries are rejected to prevent silently freezing mutable external content.

## Verification and recovery

The harness tests exercise a known 2x speedup, unchanged-control regression, primary/tail regression, confidence uncertainty, equal-performance no-regression behavior, missing/nonfinite samples, output drift, source hash tampering, runtime/scope/quality/capacity mismatch, pairing, isolated PIDs, experiment limits, capture immutability, collisions, symlinks, real subprocess execution, and disk corruption. Real engine performance acceptance additionally needs an archived-source/current-source run with the desired measured horizon and a successful checker verdict.

The initial real smoke is retained at `benchmarks/results/engine-100x/runs/studio-cpu-foundation-20260910-01/`, with an additional `baseline-origin.json` receipt. It verified the archive hash, extracted the archive, and verified all 99 frozen file hashes before measurement, then ran four pairs, 24 warmup steps, and 48 measured steps for all nine study/instance cases. The run took 24.46 seconds and retained eight fresh process receipts. Exact numerical output and retained identity checks passed. **Timing qualification failed:** the unchanged-control baseline/candidate ratio was 0.637 (95% interval 0.608–1.016), and bridge with four instances also had an interval crossing the CPU no-regression threshold. Its apparent workload gains are not qualified speedups. This is useful negative evidence for the measurement gate, not a completed performance milestone. The run's own retained harness hashes identify the script revision used; subsequent checker hardening does not rewrite that run.

Rollback consists of stopping only the owned benchmark processes and removing only this packet's new scripts/tests/docs if unwanted. Keep frozen legacy evidence and other task work intact. New runs are append-only directories: retain useful failed evidence and remove only owned temporary extraction/test fixtures after their process handles close. No source, package, server, global manifest, or shared dependency state is mutated by these tools.

## Later Studio comparison

The complete `studio-cpu-optimized-20260910-03/` run used six pairs, 120 warmup ticks and 240 measured ticks across all nine study/instance cases. Exact output and source identities passed. The original checker rejected clock-quantized zero measurements in very short topology calls. The revised checker accepts finite zero **individual** stage samples while still rejecting negative/nonfinite data, all-zero process means and invalid controls. Its 19-test harness suite includes this distinction. The original result and gate were retained; the new verdict is in `gate-clock-resolution-review.json`.

That verdict remains **inconclusive**, because the unchanged control ratio was 1.0213 with a 0.9943–1.6183 interval. The original 15% control threshold was not changed. Every workload's declared complete CPU-cycle comparison cleared its own regression/uncertainty gate, but no timing gain is accepted while the control is unqualified. Prior attempts `studio-cpu-optimized-20260910-01/` and `-02/` retained their total-run and child-process timeout receipts respectively.

## Packed storage and retained memory

`studio-typed-arrays-20260910-01/` and `-02/` both compare the experimental packed solver against the source captured at `benchmarks/baselines/studio-before-typed-arrays-20260910/`. Both retain complete six-pair/nine-case runs with exact output. Both **failed** performance qualification. The default solver therefore retains its object kernel; `PackedFailureSimulation` is an explicit experimental API. [The storage report](STUDIO_SOLVER_STORAGE.md) records the failed comparisons and the memory tradeoff.

The separate retained-memory probe does not time operations or estimate allocation rate:

```sh
node scripts/studio-storage-memory.mjs \
  --baseline-root /absolute/path/to/frozen-before-source \
  --candidate-root /absolute/path/to/frozen-candidate-source \
  --out /absolute/path/to/new-memory-run
```

Each study/mode has four balanced process pairs, two warmup specimens, eight retained specimens, sixteen ticks per specimen and three explicit GC calls before/after measurement. One mode avoids public object views; the other reads all node/link views. It records retained `heapUsed + arrayBuffers`, full-precision checkpoint hashes, source/harness/runtime identity and all raw results. It requires a fresh output outside either input root and bounds each process to 30 seconds and the campaign to 180 seconds.

`studio-typed-memory-20260910-01/` measures the packed experiment. `studio-index-memory-20260910-01/` isolates the construction-index cleanup accepted in the default solver. Neither is a browser-memory or allocation-rate qualification. Recheck their raw hashes and recompute their summaries without overwriting evidence:

```sh
python3 benchmarks/results/engine-100x/verification-studio-storage-20260910/verify-memory.py
```

## Native capacity and completed frames

[Native capacity](NATIVE_CAPACITY.md) records exact 4K/16K/64K body staging and dense contact-pair frame distributions. `scripts/native-capacity-renderer-qualify.mjs`, invoked by the renderer runtime test, reads back every matrix/color byte, checks full direct/indirect instance counts and stable IDs, preserves growth pixels, and records native step/upload/encoding/GPU-completion samples. The two sequential Metal runs are descriptive capacity evidence; do not use them as a controlled direct/partition speed comparison or browser FPS claim. The native exact-catalog harness accepts `--candidate-root` to freeze an isolated candidate's actual C/TypeScript source instead of incorrectly labelling it with the live checkout.

## Native body recycling

[Native body lifetime](NATIVE_BODY_LIFECYCLE.md) records 1,048,576 create/destroy pairs across a hot slot and permuted 1,024-body batches, with 128 bounded-memory checkpoints. `scripts/native-recycling-check.mjs` rehashes frozen inputs, checks lifecycle/generation/rejection arithmetic, and can additionally verify the final source/artifact/capacity/lifecycle/Metal packet. GPU rendering is checked against complete copied streams before and after deletion, row compaction, reuse, growth and reset. Elapsed lifecycle time and sequential dense-frame samples are descriptive; no throughput or partition speedup is inferred.

## Native spatial queries

The native query continuation is documented in [Native spatial queries](NATIVE_SPATIAL_QUERIES.md). `scripts/native-query-qualify.mjs --candidate-root SOURCE --candidate-artifacts ARTIFACTS --out NEW_DIRECTORY` freezes the bridge, adapter, artifacts and independent scalar oracle before checking 5,888 queries through 64K bodies. `scripts/native-query-check.mjs --run FROZEN_RUN` rehashes the retained records and recomputes geometric errors. The SDK's overlap distance slop and nonunique incident edge normals are explicit; initial failed assumptions remain in runs 01–03. This suite establishes query correctness/capacity, not query latency or an engine-wide speed multiplier.

## Shared worker snapshots

[Shared Studio snapshots](STUDIO_SHARED_SNAPSHOTS.md) documents the optional transport and its fixed storage. `scripts/studio-shared-stress.mjs --out NEW_DIRECTORY` runs concurrent producer/consumer publication with delayed reads and writes. `scripts/studio-shared-check.mjs --run RUN_DIRECTORY` rehashes that record and validates its counts. `scripts/studio-shared-benchmark.mjs --out NEW_DIRECTORY` runs six balanced process pairs for exact transfer/shared inspection and two-tick snapshots; `--check RUN_DIRECTORY` independently rehashes the inputs and recomputes the gate. Copying, protocol validation and scheduling remain in the timed round trip. The first comparison established no qualified speedup and is preserved as such. The default transport is unchanged.

## Closed-water completed-frame comparison

The water harness defaults to the inherited absorbing equations and preserves their original protocol. Select `--model closed` for the conservative C-grid equations. The closed comparison first independently audits an existing physical qualification and requires exact matching hashes for the CPU reference, configuration, GPU adapter and WGSL solver. `accuracy-link.json` identifies that qualification; a changed solver cannot borrow the previous solver's acceptance.

```sh
# New timing experiment; use a fresh output only after workload conditions change.
node scripts/gpu-water-benchmark.mjs --model closed \
  --accuracy-run benchmarks/results/engine-100x/runs/closed-water-accuracy-20260910-03 \
  --out /absolute/path/to/new-closed-water-frame-run

# Rehash and recompute retained numerical evidence and timing qualification.
node scripts/gpu-water-benchmark.mjs \
  --check benchmarks/results/engine-100x/runs/closed-water-render-crossover-20260910-02

# Focused evidence checks; this does not run another timing experiment.
node --test --test-concurrency=1 tests/engine/water-benchmark.test.mjs \
  tests/qualification/closed-water-evidence.test.mjs
```

The default experiment is six adjacent fresh-process pairs in balanced AB/BA order, five grid sizes from 64² to 1024², eight warmup and 24 measured frames per grid, and four 1/240-second ticks per frame. CPU stepping plus three full-field uploads is compared with GPU-resident stepping. Both encode the same 512×320 render and await queue completion inside every timed frame. Both use the same indexed display mesh, closed-basin spacing, material and face-to-centre interpolation. These are serialized offscreen completed-frame latencies; browser presentation and interactive FPS are excluded.

All six initial and final float32 fields are retained in content-addressed files outside the timed interval, together with every raw process/task record and frozen source. The read-only checker regenerates the initial recipe, replays the frozen CPU reference, recomputes all six component tolerances (`5e-5 + 5e-5*abs(reference)`), volume error (at most `1e-4` of initial L1 volume) and exact zero wall velocity. Repeated state files are deduplicated by verified bytes; every sample's descriptor is still checked.

Each process runs the unchanged CPU control and a verified GPU integer-mix control before and after its water suite. The GPU kernel has 1,024 workgroups of 64 invocations, each running 256 integer iterations. Default protocol 3 has 128 dispatches per sample, four warmups, eight samples before and eight after, with 16 output words verified against the CPU before and after. The actual count must be 2,560 dispatches per process. Explicit `--gpu-control-dispatches 4` preserves protocol 2 for the first run; no other count is accepted.

The paired-bootstrap 95% intervals for **both** unchanged controls must lie inside 0.85–1.15 before a speedup can qualify. A grid also needs a lower ratio bound of at least 1.05 and candidate p95 no greater than 1.05 times baseline p95. The numerical and identity checks precede timing acceptance; missing or altered evidence is incomparable. Valid evidence with unqualified controls is inconclusive (exit 2), including during `--check`. No speedup is accepted by that exit status.

The retained runs `closed-water-render-crossover-20260910-01/` and `-02/` both passed complete field audits but failed their GPU control intervals, respectively 0.8083–1.0606 and 0.8836–1.2623. Their raw descriptive ratios remain in `result.json`; **neither run qualifies a speedup**. Run 02 lengthened only the control workload after the first noisy result; no water setting or threshold changed. The historical inherited-model result remains separate. Host observations, both checks and 11 passing focused tests are indexed in `verification-closed-water-frames-20260910/`. Further timing acceptance requires a newly declared run under changed, verified quieter conditions; independent numerical work remains available meanwhile.

## Compliant cable accuracy

[Compliant cable](COMPLIANT_CABLE.md) records a separate physical-reference qualification, without timing acceptance. `node scripts/cable-qualify.mjs --out NEW_DIRECTORY` freezes its declared 28-case matrix, source, 702 full sampled states, checkpoints and continuations. `node scripts/cable-check.mjs RUN_DIRECTORY` rehashes the frozen evidence, independently replays every retained state and recomputes the implicit-spring, continuum-refinement, distributed-extension, force, momentum and energy gates. The current accepted run is `compliant-cable-accuracy-20260910-04/`; earlier CLI and signed-zero checkpoint failures remain preserved. Its axial acceptance is not a qualification of curved-cable equilibrium, cloth bending, material calibration or an engine-wide speed multiplier.

## Nonlinear cable accuracy (11 September 2026)

`runs/proximal-cable-accuracy-20260911-02/` qualifies the separate vector-proximal backend against nonlinear scalar steps, discrete force-polygon equilibrium and an extensible continuum catenary. Its audit replays 505 complete sampled states and every-tick checks over 16,564 ticks, including exact warm-start checkpoint continuation. The 21-case gate includes a deliberately under-converged case. All 702 historical scalar-XPBD states remain exact. This is numerical acceptance; no timed performance comparison or 100x gain is claimed. See [the nonlinear cable contract](NONLINEAR_CABLE.md).


## Linear frame accuracy qualification

`frame-accuracy-20260911-04` uses protocol version 4 and exact full-state replay for 52 cases, 704 sampled states and 24,980 outer ticks. It covers six static load components, gravity, equilibrated member end actions, axial/torsional discrete trajectories, independent spatial-frame dynamics, bending mesh/time refinement, and explicit failure/domain cases. Refer to [Frame mechanics](FRAME_MECHANICS.md) for equations, error maxima, phase limitations and replay commands. The preceding three runs remain historical. No timing gain or bridge calibration is established.
