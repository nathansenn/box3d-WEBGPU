# Supporting evidence

These are the remaining records from the merge benchmark session, on 2026-11-01. The report is [`docs/BENCHMARKS_MERGE_20261101.md`](../../../docs/BENCHMARKS_MERGE_20261101.md), and [`SUMMARY.md`](SUMMARY.md) is generated from the result files beside this one.

## `swiftshader/`: browser harnesses on a software GPU

These ran in headless Chromium with `--use-angle=swiftshader`, using the harnesses' `--quick` settings, on the CPU host before the GPU pod existed. SwiftShader proves correctness only; its timings are not performance evidence.

- **`rendering-control-quick.json`:** the merged renderer against the colour-pipeline control baseline. Status PASSED: 84/84 byte-exact images, 21 visibility checks, 3 quality corrections, 25 shadow-cache checks, 24 timing comparisons and 0 GPU validation errors. The PNGs are the quality-correction images this run saved.
- **`rendering-quick.json`:** the first attempt against the unmodified pinned baseline. It failed for two reasons, and both changed the harness:
  - The merged renderer timed its own passes ("Renderer supplied timestamps; harness must not overwrite them"). The harness now creates renderers with `gpuTiming: false`.
  - Every image differed by the intended colour change, which led to the control baseline.
- **`math-browser-quick.json`:** JavaScript, scalar WASM, SIMD WASM and WebGPU water solvers all validated at 48×40 and 96×80.
- **`math-render-parity-quick.json`:** resident-water rendering pixel-exact at 0, 1 and 4 steps.

## `gpu-l4/archives/`: complete raw output of each pod pass

These are the pod's output directories exactly as downloaded. The curated files in `gpu-l4/browser`, `gpu-l4/dawn`, `gpu-l4/host` and `gpu-l4/diagnostics` were taken from them. The scripts that produced each pass are in `gpu-l4/diagnostics/`.

| Archive | Pod script | Contents |
| --- | --- | --- |
| `first-pass.tgz` | `pod-run-first-pass.sh` | GPU and driver reports; Dawn resident water, upload cache and partition off; the GPU water frames. Start-up (output path) and partition on (test assertion) failed and were redone in the next pass. The browser runs were blocked by the first-adapter quirk. |
| `dawn-pass.tgz` | `pod-run-dawn-pass.sh` | The seven-flag-set adapter probe, renderer start-up, and partition on/off. The browser runs were still blocked: they had no adapter retry yet. |
| `browser-pass.tgz` | `pod-run-browser-pass.sh` | Rendering (pinned and control) and the math-runtime browser and render-parity runs, after the adapter retry. |

## `glass-profiling/`: diagnosis of the glass lab slowdown

These were recorded before the benchmarks, while finding why fractured glass is slow. Every probe runs the glass lab's default program, "Radial impact" with an annealed pane, stepped at 120 Hz on the CPU host.

- **`glass-compare-baseline.log`:** step cost per 0.25 s of simulated time, with retry counters. 4.0 simulated seconds took 111.6 s of wall time; the median step was 166.5 ms and the worst 1.19 s. Rollback levels reached 5, distributed as `{0: 481, 1: 344, 2: 268, 3: 336, 4: 196, 5: 22}`.
- **`glass-profile-annealed.log`:** the same program to its full 12 s, which took 296.3 s of wall time.
- **`glass-cpuprof-run.log`:** a run with function timers. The timers nest, so the recursive `stepInterval` total exceeds wall time.
- **`glass-settled-prof.log`:** the 3–4 s window after the shards settle, at a mean of 178 ms per step.
- **`*.cpuprofile`:** V8 CPU profiles of the full run, the settled window, and the 1.5–1.75 s window without retries. Open them in Chrome DevTools.
- **`scripts/`:** the probes that produced the logs. Each takes the path of a source tree.
- **`source-snapshots.tgz`:** the trees those probes ran on, a copy of the merged sources with explicit `.ts` import paths so Node runs them directly. `glassprof-instr` adds rollback counters at every retry site in `src/engine/convex-contact.ts`. `glassprof-noretry` is a scratch prototype that accepts an unconverged sweep instead of rolling back. It exists only to measure what the rollback costs and is not a proposed fix.

## `validation/`: the test runs behind the PR's claims

- **`ci-local.sh`:** runs the 25 steps of `.github/workflows/ci.yml` in order and records each exit status. Usage: `ci-local.sh <repo> <outdir>`. A relative `<outdir>` now resolves from the caller's directory; before that fix, its logs were lost. The recorded runs passed absolute paths, so the fix does not affect them.
- **`ci-local-before-fixes/`:** the merged tree before the CI repairs, 21/25 passing. The failures were the source manifest, projection depth, self-test and rope batching.
- **`ci-local-fresh-checkout/`:** `30c0716` in a git worktree, 24/25 passing. The one failure was the manifest check tripping on the worktree's `.git` file, which commit `d9627d3` makes it ignore.
- **`validate-v1.20-fresh-checkout.log`:** `npm run validate:v1.20` on a fresh checkout of `aefec89`. It stops at `verify:soft-kernels`, which rebuilds the kernels with the local clang 18.1.3 and byte-compares them to the committed binaries. That step fails the same way on `main` in this container.
- **`validate-v1.20-remaining-steps.log`:** every remaining `validate:v1.20` step on the same checkout, all passing. `…-attempt1.log` is an earlier attempt that called the system `tsc` by mistake and hit the one-off Dawn segfault.
- **`runtime-test-repeat.log`:** 30 consecutive runs of the renderer runtime test on `a511ecc`, with 0 failures.
- **`engine-tests-merged.log`** and **`pre-merge-branches/`:** `tests/engine`, rope-batching and renderer runtime results on `main` and on each source branch before merging. They show which failures predate the merge.
