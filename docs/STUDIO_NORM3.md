# Studio norm optimization

Roadmap item **M009** targets the three-component length calculation inside the twelve-pass constraint loop. The new mode preserves scaling and rounding compensation while specializing the calculation to three arguments. The qualified mode is now selected for fresh Metal press, canopy and bridge runs in the local Studio UI. The original API default and saved numerical backends remain supported.

## Arithmetic and compatibility

The candidate divides absolute components by their maximum, accumulates the first two squares with a rounding correction, then adds the corrected third square before taking the square root and restoring the scale. Zero and nonfinite inputs use the host `Math.hypot` behavior. The arithmetic follows the three-argument branch of [V8 FastMathHypot](https://raw.githubusercontent.com/v8/v8/main/src/builtins/math.tq). The [ECMAScript specification](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.hypot) does not promise bitwise equivalence between different implementations; actual runtime comparisons are required.

The new checkpoint identity is `studio-pbd-scaled-norm3-js-v1`. The API default remains `studio-pbd-js-v1`, and saved-run factories select the backend recorded in the checkpoint. A direct restore into another backend is rejected before changing the receiver. Runtime capabilities and worker responses must match the requested backend, including resets and checkpoint replies. Transfer/shared snapshot loans retain their original ownership across resets.

Integration candidate 03 selects the step method once during construction. Its legacy step body is identical to the frozen baseline. The specialized step is generated from that body with only the constraint norm call replaced. The generation check is:

```sh
node scripts/generate-studio-scaled-step.mjs --check
```

This keeps backend selection outside the constraint loop. When changing the legacy step, regenerate the specialized method and repeat the numerical and performance checks. No material law, damage threshold, iteration count, step size, visit order or contact rule is intentionally changed.

## Numerical evidence

The scalar prototype matches installed Node v26.0.0 `Math.hypot` on 100,005 finite triples plus the special-value checks. An independent 150-digit Decimal oracle measures a maximum normal relative error of **2.82e-16**. The separately declared subnormal allowance is half a minimum subnormal unit, `2^-1075`; large relative errors at subnormal magnitudes describe quantization, not normal-range accuracy. See the [scalar result](/Users/commander/box3d-WEBGPU/benchmarks/experiments/studio-compensated-norm3-20260911/scalar-result.json).

The prototype and all three integrations preserve **1,884 complete physical checkpoint samples**: 38 twelve-second scenarios, each sampled every 30 ticks, plus 60 per-tick mass/load edits. Runs restore at tick 720 and unload before tick 1201. Only the two declared backend identity strings are normalized for the comparison; all physical checkpoint fields remain included. These are sampled-state comparisons against the inherited authored PBD model, not calibration against physical metal test data. The [final candidate comparison audit](/Users/commander/box3d-WEBGPU/benchmarks/experiments/studio-norm3-integration-20260911-03/comparison-review.json) also verifies 14 passing integration tests and a full project typecheck with the eleven staged source files substituted.

The local Chrome 152 module-worker check for integration 03 matches **10,005 finite and 729 special scalar cases**, plus **240 sampled physical checkpoints** across default press, four dimples, titanium, canopy and bridge. Each browser scenario includes twelve seconds, restore and unloading. The probe reports no warnings/errors and its owned tab was closed. See the [browser result](/Users/commander/box3d-WEBGPU/benchmarks/experiments/studio-norm3-integration-20260911-03/browser-result.json) and the [bounded local-browser exception](/Users/commander/box3d-WEBGPU/benchmarks/experiments/studio-norm3-integration-20260911-03/browser-contract.json).

## Timing protocol

Each timing run uses six fresh Node processes, one at a time, with a 512 MiB heap cap. Five integration workloads include both the new and legacy press modes. Every workload has a separate warmup, 1,440 fixed ticks, six two-second phases and an unchanged control. Three variants run in balanced order. The 8,640 timed blocks each contain 15 ticks; their distributions describe block-mean CPU step costs, not individual-frame or individual-step percentiles.

Paired geometric-mean ratios use 95% Student-t intervals in log space. Acceptance requires the unchanged-control interval inside 0.90–1.10, the default new press median lower bound at least 1.02, every other median lower bound at least 0.95, and every p95/phase lower bound at least 0.95. All gates are declared before measuring. Construction, transport, checkpoint export, geometry updates and rendering are outside the timing scope.

## Accepted integration 03

The final integration passes every numerical, unchanged-control, median, p95 and phase gate. Ratios below divide baseline CPU cost by candidate CPU cost.

| Workload | CPU throughput ratio | Paired 95% interval | p95 block-mean ratio |
| --- | ---: | ---: | ---: |
| Default press | 1.387× | 1.374–1.400× | 1.344× |
| Aluminum draw (wide platen) | 1.397× | 1.375–1.419× | 1.341× |
| Legacy press compatibility | 1.016× | 1.002–1.030× | 0.997× |
| Canopy | 1.469× | 1.430–1.509× | 1.457× |
| Bridge | 1.359× | 1.297–1.424× | 1.285× |

The independently recomputed [timing review](/Users/commander/box3d-WEBGPU/benchmarks/experiments/studio-norm3-integration-20260911-03/timing/review.json) retains all six raw process results and verifies 8,640 timed blocks. The legacy row establishes compatibility performance within the declared bounds; it is not a new arithmetic optimization.

The applied source passes **42/42 focused production tests**, a full no-emit TypeScript check and the generated-step consistency check. The native WebGPU app completed the default press at **11.82 s**, with **433 connections lost** and **153.0 mm displayed deflection**. Both camera angles rendered correctly. Replay returned to an intact plate at zero and restored the completed state. Pause held at 9.42 s during retraction; resume completed normally, and reset returned to zero. No warnings or errors were reported. See the [application review](/Users/commander/box3d-WEBGPU/benchmarks/experiments/studio-norm3-integration-20260911-03/application-review.json).

The qualified eleven-file source identity is `425bc25bfb924d1ef078052374641506a7a9a788b08da7d076dcada4c3c59c4e`. Six production source files changed; the retained legacy step body is byte-identical to the frozen baseline. The application checks are functional and visual, not a browser-FPS benchmark.

## Trials and integration outcomes

| Candidate | Numerical result | Reason rejected |
| --- | --- | --- |
| M001: move unused strain work | 230 sampled checkpoints exact | Default press timing failed; original source restored. |
| Guarded direct square-root norm | Three scenarios diverged | Four dimples and titanium changed fracture outcomes; canopy exceeded trajectory tolerances. |
| M003/M004/M020 combined contact reuse | 1,884 sampled checkpoints exact | Default press speedup and wide-platen p95 gates failed. This rejects the combined candidate, not every individual hoist. |
| Compensated norm prototype | Scalar and 1,884 checkpoint comparisons passed | Prototype CPU gates passed at 1.36–1.46×, but it did not yet implement legacy/application compatibility. |
| Integration 01: indirect norm calls | 1,884 sampled checkpoints exact | Legacy and canopy timing gates failed. |
| Integration 02: branch per constraint | 1,884 sampled checkpoints exact | New-mode workloads passed at 1.29–1.35×, but legacy press p95 lower bound was 0.938, below the required 0.95. |

Raw inputs, candidate source hashes, controls and rejected results remain in their experiment directories. No failed trial is counted as a production speedup, and no ratio here establishes a 100× whole-engine or browser-FPS gain.
