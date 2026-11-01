# Threaded engine (pthread artifact)

Box3D has a second, separately selected artifact, `public/box3d/box3d-mt.{js,wasm}`, that solves one world on several worker threads. It reproduces the **single-threaded artifact's simulation state bit for bit** (verified, [§7](#7-determinism)) and it is **faster once a world has thousands of awake bodies**. It is **not a 100× change**: under heavy machine load the measured gain is about **1.4–2.8×** at 4,096–16,384 awake bodies, it is a loss at small counts, and its speed on a quiet machine has **not been measured**. The single-threaded `box3d.{js,wasm}` is untouched, stays the fallback whenever a page cannot use threads, and is the oracle the threaded artifact is tested against.

> **Scope.** This moves only scorecard 1 (active rigid-body stepping) of [ENGINE_100X_ROADMAP.md](ENGINE_100X_ROADMAP.md): roadmap item 21. It is not a rendering, interactive-capacity (p95 16.67 ms / p99 25 ms), or engineering-capability result, and no ratio here is multiplied with a ratio from another scorecard. Every timing below was taken on a loaded machine and says so.

## 1. Claims and how sure each one is

Bands: KNOWN, STRONG, LIKELY, POSSIBLE, UNKNOWN. Provenance: *computed* (a run produced it), *reasoned*, *assumed*.

| # | Claim | Band | Basis and limits |
|---|---|---|---|
| 1 | The threaded artifact's state equals the single-threaded artifact's at 1, 2, 4 and 8 workers: 800-scene catalog, mid-run worker-count changes, awake-threshold crossings, interleaved native-world contexts, a module with no worker pool | KNOWN, *computed* | [`determinism.json`](../benchmarks/results/engine-100x/runs/threaded-engine-20261001-01/determinism.json): 3,322 exact comparisons, 0 mismatches, 8,292 engagement checks with 0 unengaged. One host: Node v26.0.0, darwin-arm64, 32 logical CPUs |
| 2 | The same holds in other browsers, engines, CPUs or operating systems | UNKNOWN | Not tested. One browser replay-hash comparison (8 workers, 2,048 bodies, 6 checkpoints) agreed, but its captures were not retained, so it is not evidence |
| 3 | Worlds with 4,096–16,384 awake bodies step faster on 4–8 workers, by about 1.4–2.8× under load 63–121 on 32 CPUs | direction STRONG, size LIKELY, *computed* | [§8](#8-measured-performance) tables A and B. Per-run p50 spread inside one configuration is 1.2–3.6× (median 1.6×), so 3-run medians are weak |
| 4 | Under heavy load, a 1,024-awake world forced onto workers is slower or break-even (0.68–0.98×; 0.88–1.04× at load 63–69) | KNOWN for those windows, *computed* | Tables A and B. At load 39–47 the same size gained 1.4–2.2× on a pre-final build (table C) |
| 5 | The default awake threshold of 384 is a sound default | LIKELY, *reasoned* | Tuned at load 39–47 on a pre-final build. Under heavy load the break-even is higher, so 1,024-awake worlds are threaded at a loss there ([§8](#8-measured-performance), [§11](#11-limits-and-next-steps)) |
| 6 | Speedup of the shipped artifact on a quiet machine | UNKNOWN | No window of this work meets the benchmark's own quiet rule (load ≤ half the CPU count, 16 here); the lowest web window was 39 on 32 CPUs, and the native reference window was 24–29. Earlier builds reached 3.9–4.8× at 16K–64K awake bodies with 8 workers at load 42–65, and a native build of the same solver reached 4.5–5.2× at 8 workers. Neither is a measurement of the shipped artifact |
| 7 | There is no transport cost | KNOWN, *reasoned* and *computed* | State lives in one shared `WebAssembly.Memory` ([§3](#3-design)); `sharedMemory: true` in all 35 threaded benchmark runs |
| 8 | Starting the threaded module costs 98–394 ms at 2–8 workers against 29–84 ms single-threaded | *computed*, load-contaminated | Table A, Node only; browser startup was not retained |
| 9 | The pthread artifact causes the two rare Node 26.0.0 failures of [§9](#9-two-node-2600-reliability-hazards) | UNKNOWN | Neither proven nor cleared: 2 events in 116 threaded runs, 0 in 109 single-threaded runs |
| 10 | Any 100× rigid-body capacity gain | **not claimed, not supported** | The CPU-thread envelope measured here is at most 7.5× (native, 24 threads, 65,536 awake bodies). The only route identified to 100× capacity is a separate GPU-resident solver on a restricted shape set; that is deferred research |

## 2. Roadmap item 21

Enhancement: connect Box3D's task scheduling to a bounded pthread pool instead of `workerCount = 1`, with task callbacks and a separately selected threaded artifact. Acceptance: benchmark 1/2/4/8 workers on contact-heavy scenes including startup and transport; prove deterministic guarantees per supported mode; retain single-thread deployment.

| Acceptance part | Where it is met | State |
|---|---|---|
| Benchmark 1/2/4/8 workers, contact-heavy scenes | [§8](#8-measured-performance) table A: dense rain, 1,024 / 4,096 / 16,384 bodies, `st`, `mt1`, `mt2`, `mt4`, `mt8`, 3 interleaved runs, artifact shas recorded | done, load-contaminated |
| Startup | Table A startup column | done, Node only |
| Transport | None exists: one shared memory, the main thread calls the step and reads the matrices in place | by construction |
| Determinism per supported mode | [§7](#7-determinism): Node exhaustive; browser one-off and not retained; other engines UNKNOWN | partial by scope |
| Retain single-thread deployment | Default artifacts byte-identical; `?threads=off`; visible fall back ([§5](#5-page-plan-and-loader)) | done |

[ENGINE_100X_STATUS.json](ENGINE_100X_STATUS.json) records the item as `implemented`, which its legend defines as "code path implemented; listed qualification still required". The `remaining` list there is that qualification.

## 3. Design

1. **The qualified bridge is not edited.** `wasm/box3d_web.c` (sha256 `4af722ad…80d7`, enforced byte for byte by `npm run test:native-wasm`) is compiled unchanged into both artifacts. The threaded CMake target gives that one source two per-source definitions, `b3CreateWorld=b3w_threads_create_world;b3World_Step=b3w_threads_step`, so the bridge's two world calls land in the wrappers of `wasm/box3d_threads.c`. The bridge never learns it is threaded and needs no `#ifdef`. `box3d.h` renames `b3CreateWorld` under `BOX3D_DOUBLE_PRECISION`, which would bypass the wrapper, so `box3d_threads.c` stops with `#error` in that configuration.
2. **One shared scheduler, never destroyed.** Upstream creates its scheduler inside `b3CreateWorld` and joins it in `b3DestroyWorld`, and the bridge recreates its world on every scene switch. An Emscripten worker returns to its pool only after the main thread has reached the JavaScript event loop, so a scheduler per world would keep taking workers from a bounded pool (reasoned from the upstream source and Emscripten's model; that alternative was not built). Instead one upstream scheduler (`b3CreateScheduler`) lives for the whole module and every world reaches it through upstream's external task callbacks (`enqueueTask`, `finishTask`). Worlds are stepped one at a time on the calling thread, so one task queue is enough, and the wrapper calls `b3ResetScheduler` before each multi-worker step to recycle the per-step task slots: with external task callbacks upstream does not own the scheduler, so it does not do this itself.
3. **Spin barriers forbid serial fallback.** The solver's stages synchronise on atomic spin barriers, so a worker task must never run one after another on a single thread for a world whose worker count is above 1: it would wait for a partner that never starts. `b3w_threads_step` reads back the count upstream actually applied (`b3World_GetWorkerCount`) and the task callback runs a task inline only when that count is 1 or no scheduler exists.
4. **The worker count is a per-step policy.** A world is created on one worker. `b3w_threads_step` widens it to the requested count once at least `enter` bodies are awake (default 384) and narrows it again below `leave = enter − enter / 3` (256 by default), so a count hovering at the line does not rebuild per-worker contexts every frame. The policy changes speed only. A 480-frame run that crossed the line up twice and down once kept all 60 state checkpoints equal to the single-threaded artifact, and all 480 policy decisions matched the expected ones.
5. **Capacity is bounded by the pool.** The scheduler never exceeds the preloaded Emscripten pool plus the calling thread, clamped to `B3_MAX_WORKERS` (32), because a thread that was never started cannot be joined. A module built without a pool reports capacity 1 and runs on one worker (tested).
6. **Shared memory, no transport.** The heap is one shared `WebAssembly.Memory`. The renderer reads matrices and colours from it, and the main thread calls `b3w_world_step` directly and takes part in the solve, so it is blocked during a step exactly as it is single-threaded. Idle workers sleep on a semaphore. When a worker grows the memory the main thread's `Module.HEAP*` views go stale, so the loader wraps `HEAPF32`, the only view the app reads, to re-read the live `wasmMemory.buffer` (`withLiveHeap` in `src/physics/wasm.ts`).
7. **Upstream coupling.** Upstream's scheduler is internal (`src/scheduler.h`); its four prototypes are repeated in `box3d_threads.c` and pinned to Box3D v0.1.0 (commit `8441b4a0…d7`). A scheduler change that breaks the coupling makes the determinism test fail.

## 4. Threading ABI (threaded artifact only)

Defined in `wasm/box3d_threads.c`, exported by the threaded CMake target, absent from `box3d.js` (checked by `tests/engine/threaded-contract.test.mjs`). A fresh threaded module runs on **one** worker until the app calls `_b3w_set_worker_count`.

| Export | Meaning |
|---|---|
| `b3w_threads_supported()` | 1 in the pthread artifact. A loader treats a missing function as a single-threaded module |
| `b3w_worker_capacity()` | Threads the scheduler may use, caller included: preloaded pool + 1, clamped to [1, 32]; the scheduler's size once it exists |
| `b3w_set_worker_count(n)` | Asks for `n` workers. Clamps to [1, capacity], creates the scheduler the first time `n > 1`, returns the accepted count. Each world switches at the start of its next step |
| `b3w_get_worker_count()` | The requested count; a world below the threshold still uses 1 |
| `b3w_last_step_workers()` | Workers used by the latest step that reached the solver (1 below the threshold). A step with every body asleep never reaches it, so the value is unchanged |
| `b3w_get_thread_threshold()` / `b3w_set_thread_threshold(n)` | Awake-body count at which a world starts using its workers: default 384, 0 threads every world, a negative value clamps to 0; the setter returns the stored value |

## 5. Page plan and loader

`planThreading` (`src/physics/threading.ts`) decides from the page, in this order:

| Condition | Result |
|---|---|
| `?threads=` is `off`, `false`, `no`, `0` or `1` | single-threaded, reason "turned off with ?threads=" |
| no `SharedArrayBuffer` | single-threaded, reason "SharedArrayBuffer is not available" |
| page not `crossOriginIsolated` | single-threaded, reason "the page is not cross-origin isolated (COOP and COEP headers)" |
| `?threads=N` with N ≥ 2 | `min(N, 32)` workers |
| otherwise | `min(8, logical processors − 2)` workers; under 2 means single-threaded, reason "only N logical processors" |

An explicit `?threads=N` never overrides a missing capability (those rows come first), and an unparseable value behaves as the default. The automatic ceiling of 8 is a choice from the web builds in [§8](#8-measured-performance) table C, where 16 workers were not meaningfully faster than 8 at 16,384 and 65,536 awake bodies (3.55× against 3.93×, and 4.95× against 4.84×). The native build in table D kept gaining slowly at 65,536 (5.21× at 8 threads, 7.48× at 24), so the ceiling is conservative, not a measured optimum; `?threads=N` overrides it.

`loadPhysicsModule` (`src/physics/wasm.ts`) then loads `box3d-mt` with `workers − 1` preloaded module workers, waits at most 15,000 ms (`THREADED_START_TIMEOUT_MS`), requires `_b3w_threads_supported() === 1`, and requires `_b3w_set_worker_count(workers)` to return exactly `workers`. Any failure loads the single-threaded artifact and records "the pthread artifact did not start: …". The outcome is visible: `canvas.dataset.physicsThreads` holds the worker count (1 when single-threaded), `canvas.dataset.physicsThreadsReason` holds the reason, and the status text says "loaded on N threads" only when threads run.

Where it is wired: `loadBestPhysicsBackend` and `loadWasmPhysicsBackend` have one consumer, `src/main.ts` (the rigid-body lab). The Engineering Studio entry (`src/entry.ts`) does not load Box3D. `loadNativeWorldPool` (the multi-world registry used by `benchmarks/experiments/*probe.html`) still loads the single-threaded artifact; [NATIVE_WORLDS.md](NATIVE_WORLDS.md) states its calls are single-threaded and simultaneous calls from several threads are not qualified.

## 6. Deployment

- **Needs cross-origin isolation.** Browsers expose `SharedArrayBuffer` only to pages served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. The vite dev server and the vite preview server send both (`crossOriginIsolation` in `vite.config.ts`, on `server` and on `preview`) and bind `127.0.0.1` through `npm run dev` and `npm run preview`. The contract test checks both headers and that no script in `package.json` listens beyond loopback: a `0.0.0.0` host, a bare `--host`, a `--host`, `--hostname` or `--bind` other than `127.0.0.1`, `localhost` or `::1`, and `http.server` without `--bind 127.0.0.1` all fail it.
- **No deployed host isolates today, so deployed pages run single-threaded, silently.** `deploy/railway/Caddyfile` sends neither header and was **not modified**. Enabling threads there means adding `Cross-Origin-Opener-Policy same-origin` and `Cross-Origin-Embedder-Policy require-corp` to the site block, re-checking that every subresource is same-origin or sends CORP/CORS, and confirming the Dockerfile stages `public/box3d/` (its COPY list does not mention `box3d/`; unverified). GitHub Pages cannot set response headers; a service-worker shim would be a separate decision, not taken here.
- **Isolation has a cost for the whole page.** With COEP `require-corp` every cross-origin subresource must opt in. A static check found none: the Engineering Studio `index.html` has no cross-origin subresources and `src/` has no cross-origin runtime fetches (the only URL literal is `'http://localhost/'` at `src/assets/ktx2.ts:271`). The Studio was not loaded in a browser under the headers, so this is a source check, not a runtime one.
- **Size.** `box3d-mt.js` (33,569 bytes) and `box3d-mt.wasm` (470,198 bytes) add 503,767 bytes to `public/`. They are fetched only when the plan says to use threads.

## 7. Determinism

`scripts/threaded-determinism-test.mjs` (`npm run test:threaded`) uses the shipped single-threaded artifact as oracle. For every state it compares the matrix stream, the colour stream, the replay hash and the body count. Recorded run (`determinism.json`, sha256 `9ed1c6b8…015af`):

| Check | Result |
|---|---|
| 800-scene catalog at 1, 2, 4 and 8 workers, threshold 0 so small scenes use their workers | equal |
| Worker count changed mid-run | equal |
| Awake threshold crossed up twice and down once (480 frames, target 1,200 bodies, 8 workers; awake 156–1,199; 350 threaded frames) | 60 of 60 checkpoints equal; 480 of 480 policy decisions as expected |
| Four native-world contexts interleaved | equal |
| Module built with no worker pool, four scenes | equal, on one worker |
| Engagement: every checked step ran on its requested workers | 8,292 checked, 0 unengaged, 1,908 skipped because every body was asleep |
| Totals | 3,322 comparisons, 0 mismatches; catalog digest `5ca95b82535a6c5f` |

The artifact shas under test are in the file. The result is recorded as `threaded.validation` in `public/box3d/BUILD_PROVENANCE.json` with a scope that claims no speedup, frame rate, 100×, browser-stability or release status. The threaded and the single-threaded provenance records are separate: a change to either set of sources or artifacts resets only its own validation to `not_run`, and never carries an old result forward.

**Not proven:** equality on other browsers, CPUs or operating systems; equality under a different Node; behaviour of a browser that schedules workers differently. Worker count is a performance knob, so any governor that changes it (by awake count, by load, or by the user) cannot change a result; that follows from the tested equality and is not a separate proof.

## 8. Measured performance

**Method.** Dense rain, as in [NATIVE_CAPACITY.md](NATIVE_CAPACITY.md): scene 0, stress 1, seed 42, fill to N bodies with rain spread `12·sqrt(N / 4096)` at height 2, `dt` 1/60, 4 substeps, 8 warm-up and 24 measured frames of `b3w_world_step`. `npm run bench:threaded` runs every measurement in a fresh Node process, interleaves the configurations within each repetition, forces the requested worker count (threshold 0), and exits non-zero if any completed state differs from the single-threaded artifact's. The benchmark hosts in this section: Apple M3 Ultra, 32 logical CPUs, macOS 27.0 (build 26A5421a), Node v26.0.0, Emscripten 4.0.23, SIMD128.

**Every number below is load-contaminated.** Another workload ran on the machine throughout, at load average 39–121 on 32 CPUs in the web windows and 24–29 in the native one. The benchmark's quiet rule is load ≤ 16 here, and no window met it. The single-threaded artifact at 4,096 bodies took 31–45 ms per frame in table A against 12.5 ms for a whole quiet-machine frame of the repository's own dense workload, which also uploads and renders ([NATIVE_CAPACITY.md](NATIVE_CAPACITY.md)), so absolute times are inflated by at least 2.5–3.6× (a quiet step alone is shorter than that frame), and ratios suffer too: spin barriers lose more than a single thread when cores are contended. That mechanism is consistent with the windows (the same 1,024-body, 8-worker setup read 2.19× at load 39–47, 0.88× at 63–69 and 0.98× at 100–121) but no experiment isolated it, and the builds differ between windows.

### A. Shipped artifact: final matrix (primary evidence)

Artifact bytes are recorded in [`bench-matrix.json`](../benchmarks/results/engine-100x/runs/threaded-engine-20261001-01/bench-matrix.json) (`box3d-mt.js` sha256 `6ab89071…`, `box3d-mt.wasm` `da3f927a…`, the same as `determinism.json`). Load average 99.91–121.06 on 32 CPUs (103.97 before the first run), `quietMachine: false`, 3 interleaved runs, threshold 0. "Median p50" is the median of the runs' frame-time medians; the ratio in brackets uses each configuration's fastest frame instead. Startup is the time from importing the factory to a ready module.

| Bodies | Config | Runs | Median p50 ms | Run p50s (ms) | Speedup vs `st` (by min) | Startup ms | Equals `st` |
|---:|---|---:|---:|---|---:|---:|:-:|
| 1024 | st | 3 | 3.729 | 3.44 / 3.73 / 4.67 | 1.00× | 37 | yes |
| 1024 | mt1 | 3 | 5.524 | 3.60 / 5.52 / 6.20 | 0.68× (0.80×) | 56 | yes |
| 1024 | mt2 | 3 | 5.353 | 5.33 / 5.35 / 6.73 | 0.70× (0.88×) | 123 | yes |
| 1024 | mt4 | 3 | 4.581 | 3.99 / 6.27 / 4.58 | 0.81× (0.85×) | 192 | yes |
| 1024 | mt8 | 3 | 3.819 | 3.67 / 3.82 / 7.17 | 0.98× (1.12×) | 370 | yes |
| 4096 | st | 3 | 34.843 | 34.84 / 45.34 / 31.48 | 1.00× | 29 | yes |
| 4096 | mt1 | 3 | 48.053 | 25.94 / 52.78 / 48.05 | 0.73× (1.22×) | 49 | yes |
| 4096 | mt2 | 3 | 24.292 | 24.29 / 28.24 / 24.28 | 1.43× (1.44×) | 98 | yes |
| 4096 | mt4 | **2** | 17.719 | 17.72 / 29.88 | 1.97× (1.94×) | 123 | yes |
| 4096 | mt8 | 3 | 21.413 | 14.73 / 52.63 / 21.41 | 1.63× (2.14×) | 394 | yes |
| 16384 | st | 3 | 222.504 | 222.50 / 254.74 / 220.31 | 1.00× | 84 | yes |
| 16384 | mt1 | 3 | 213.130 | 213.13 / 310.91 / 184.64 | 1.04× (0.80×) | 36 | yes |
| 16384 | mt2 | 3 | 115.751 | 115.75 / 107.87 / 163.70 | 1.92× (1.96×) | 214 | yes |
| 16384 | mt4 | 3 | 79.023 | 61.39 / 79.02 / 139.35 | 2.82× (2.25×) | 191 | yes |
| 16384 | mt8 | 3 | 85.770 | 82.09 / 103.34 / 85.77 | 2.59× (2.49×) | 255 | yes |

- **One run is missing and is recorded, not dropped.** The `mt4`, 4,096-body run of repetition 2 died with SIGILL ([§9](#9-two-node-2600-reliability-hazards), hazard A), so that cell has 2 runs, and the matrix exited 1 because of it. It is in `failures` in the JSON. The matrix predates the `exitHangs` field, so that field is absent from it.
- Every completed state equals the single-threaded artifact's (one distinct hash per size, replay hash included), all 35 threaded runs used shared memory, and every threaded run used its requested workers on 32 of 32 frames.
- `mt1` is the threaded artifact on one worker: it shows the overhead of the threaded build itself (0.68–1.04× here) and is not a recommended mode.

### B. Final ABI, scratch build (context)

Load 63.4–68.8, threshold 384, pool 7 of capacity 8, measured 2026-10-01 00:57 (`earlier-windows.json`, window `final-abi-scratch`). This build had the final ABI but was made **before the last edit of `box3d_threads.c`, and its bytes were not recorded**, so it is not verified to be the shipped artifact. Median of 3 runs' p50, speedup against `st`:

| Bodies | st ms | mt1 | mt4 | mt8 |
|---:|---:|---:|---:|---:|
| 1024 | 2.219 | 1.04× | 0.95× | 0.88× |
| 4096 | 13.356 | 1.12× | 1.41× | 1.37× |
| 16384 | 75.108 | 1.00× | 1.73× | 1.82× |

### C. Earlier web builds: where the threshold and the worker ceiling came from (context)

Builds before the adaptive threshold, with the thread code still inside the bridge source; scratch harness; not byte-verified and not the shipped artifact. Pool = workers − 1 (exact fit). Speedup of the median p50 against `st`; `n` runs each, load as shown. `earlier-windows.json` keeps every cell with its min–max.

| Bodies | n, load | w1 | w2 | w4 | w8 | w16 |
|---:|---|---:|---:|---:|---:|---:|
| 256 | 5, 39–47 | 0.92× | 0.77× | 0.78× | 0.74× | |
| 512 | 5, 39–47 | 1.00× | 1.04× | 1.31× | 1.22× | |
| 1024 | 5, 39–47 | 0.98× | 1.37× | 1.99× | 2.19× | |
| 2048 | 5, 39–47 | 1.07× | 1.74× | 2.72× | 3.53× | |
| 4096 | 3, 42–49 | 1.10× | 1.65× | 2.39× | 1.89× | 2.44× (pool 15) |
| 16384 | 3, 42–49 | 1.01× | 1.58× | 2.52× | 3.93× | 3.55× (pool 15) |
| 65536 | 3, 55–65 | 0.92× | | 3.16× | 4.84× | 4.95× (pool 15); w24 3.48× (pool 23) |

The break-even between 256 (0.74–0.92× at 1–8 workers) and 512 (1.2–1.3× at 4–8 workers) awake bodies at load 39–47 is why the default threshold is 384. The 4,096-body `w8` cell (1.89×, run p50s 4.16–9.63 ms) is lower than `w4` inside that cell's own spread; pool sizes larger than the worker count made no difference beyond the noise. The comment above `B3W_THREAD_MIN_AWAKE_DEFAULT` in `wasm/box3d_threads.c` compresses this table to "measured with 8 workers"; its 256 and 512 ranges actually span 2–8 and 4–8 workers, and table C is the record.

### D. Native reference, not a web result (context)

A native build of the same bridge with upstream's built-in scheduler, measured at load 24–29 on 2026-09-30. Speedup against its own one-worker time:

| Bodies | w2 | w4 | w8 | w12 | w16 | w24 |
|---:|---:|---:|---:|---:|---:|---:|
| 16384 | 1.62× | 2.77× | 4.55× | 5.75× | 5.59× | 5.30× |
| 65536 | 1.54× | 2.76× | 5.21× | 5.78× | 5.95× | 7.48× |

This bounds what the solver's parallelism can give on this host: at most about 7.5× with 24 threads at 65,536 awake bodies, about 4.5–5.2× at 8 threads. It is the reason a CPU-thread route to 100× is not credible.

### How to read these numbers

1. Compare ratios inside one window; do not compare milliseconds across windows, because the load differs.
2. Per-run p50 spread inside one configuration (slowest run over fastest) is 1.2–3.6× with a median of 1.6× over the 15 cells of table A, and exceeds 2× in 3 of them (for example 4,096 `mt8`: 14.73 / 52.63 / 21.41 ms). A median of 3 is a weak estimate and the direction of a gain is sturdier than its size.
3. Table A is the only window with recorded artifact bytes. Tables B–D explain the threshold and the ceiling and are context, not proof of the shipped artifact.
4. A quiet-machine re-measurement of table A is the open measurement ([§11](#11-limits-and-next-steps)).

## 9. Two Node 26.0.0 reliability hazards

Two rare failures were seen in Node v26.0.0 child processes (the only Node version tested). Neither has an established cause. They were not seen in browser sessions, which is weak evidence because browser use was short.

| | Hazard A: SIGILL | Hazard B: exit hang |
|---|---|---|
| Seen | 1 time: the `mt4`, 4,096-body run of repetition 2 in table A | 1 time: a child in a 40-run `mt4` × 4,096 soak printed its result and never exited (killed by the runner's timeout, 240 s by default) |
| Evidence | Crash report `node-2026-10-01-013419.ips` (on the test host, pid 61757, about 1.35 s of life): `EXC_BAD_INSTRUCTION`; the faulting thread is an `em-pthread` worker running JIT-compiled Wasm; the main thread was in the event loop. The faulting word `0xd2800650` is `movz x16, #0x32`, a valid arm64 instruction | A `sample` of the stuck process showed only the main, `node-V8Worker` and inspector threads, with no worker threads and no Wasm frames. The main thread was in `Environment::Exit` → platform shutdown → thread join; the V8 worker sat in a concurrent compile job waiting for a garbage collection the exiting main thread never performs |
| Reading | Hypothesis only (POSSIBLE): an instruction-cache or jump-table patching race during background Wasm tier-up on arm64 | A Node/V8 platform-shutdown deadlock (LIKELY, from one sample), not a Wasm or barrier deadlock |

**Attribution is open.** Supervised child runs: 116 of the threaded artifact (36 in table A, 40 in an `mt4` soak, 40 in an `mt8` soak) produced both events; 109 of the single-threaded artifact (9 in table A, a 100-run control soak) produced none. If both events were unrelated to the artifact, the chance of both landing in the threaded group would be about 0.26 (0.52 for one), and 0 events in 109 bounds the single-threaded rate only below about 2.8% (95%, rule of three). The threaded artifact is neither proven to cause them nor cleared. The soak results and the scratch runner's source are kept in the run folder's `hazard-soaks.json`; the counts cover only supervised benchmark and soak children, and the soaks ran on a loaded machine (load average 77.8 to 86.3).

**What the harness does.** `scripts/supervise-child.mjs` judges a child by the result it printed. A child that prints a complete result and then fails to exit within the grace period is killed and recorded as an exit hang (`exitHangs`), and the result stands; a child that dies, exits non-zero, or never prints a result is a failure, so the SIGILL above is a failure and is never dropped. 11 tests cover the supervisor, mutation-checked. There is **no product-level mitigation** for hazard A; `?threads=off` is the user-side switch in a browser.

## 10. Build, test and provenance

```bash
source ~/emsdk/emsdk_env.sh              # Emscripten 4.0.23
npm run fetch:box3d                      # Box3D v0.1.0 into third_party/box3d (or BOX3D_ROOT=<clone>)
npm run build:wasm:mt                    # builds box3d-mt.{js,wasm}, records `threaded` in BUILD_PROVENANCE.json
npm run test:threaded -- --out=benchmarks/results/engine-100x/runs/<run>/determinism.json --record
npm run bench:threaded -- --out=<path outside the repository>.json
npm run test:engine                      # includes the source-level contract and supervisor tests
```

- Build outputs can be kept out of the repository with `B3W_BUILD_DIR=<scratch dir>` and `BOX3D_ROOT=<clone outside the repository>`; `npm run clean` removes `build/box3d-wasm-mt`. The build needs `public/box3d/BUILD_PROVENANCE.json` (from `npm run build:wasm`).
- `npm run test:threaded` is opt-in and is not part of `npm test` (about half a minute plus startup on a loaded host). `--record` needs a full run (stride 1, workers including 1, 2, 4 and 8), the default artifact directory, and an `--out` inside the repository.
- **Provenance.** `threaded.sources` holds the shas of `box3d_threads.c`, `box3d_web.c` and `CMakeLists.txt` at build time; `threaded.artifacts` the bytes and shas of the two files; `threaded.validation` the determinism result. An exact rebuild keeps the validation; any change to those sources or artifacts resets it to `not_run` instead of relabelling it. `tests/engine/threaded-contract.test.mjs` fails if the recorded shas no longer match the tree, which means `test:engine` goes red when the CMake or the bridge is edited without rebuilding the threaded artifact; that is intended.
- **`build.cmakeSha256` (the single-threaded record) was advanced** from `41a891364c3c5f4767eff405f91a038ed38de3aed5b1100e41a8efbe8bc507c3` to `79b7d1b209174b6651f9789e305bb2c4bd85eeb1e77d02810fc83f55c6e8023f`, the sha of the CMake that now contains the `B3W_THREADS` option. A rebuild of the default artifacts from this CMake is byte-identical to the shipped ones (`box3d.js` 18,281 bytes `4d333c43…`, `box3d.wasm` 460,156 bytes `c4770566…`), and the only consumers of the field (`scripts/native-query-check.mjs`, `scripts/native-capacity-check.mjs`) compare a frozen packet's provenance copy with the same packet's source manifest, so a packet frozen from this tree would otherwise fail. Frozen packets under `benchmarks/results/engine-100x/` keep their own old values.
- **The source manifest was not regenerated.** `npm run verify:source` already failed before this work (about 29,000 untracked files); nothing here changes that.

## 11. Limits and next steps

1. **Re-measure table A on a quiet machine** (`npm run bench:threaded`, load ≤ 16 on 32 CPUs). Until then the shipped artifact's quiet-machine speedup is UNKNOWN.
2. **Make the threshold load-aware.** Under heavy load it is too low: 1,024-awake worlds are threaded at a loss (table A). A governor keyed to measured step time would be a pure performance policy (results do not depend on the worker count). Until then `?threads=off` is the user switch.
3. **Move the simulation off the main thread.** The main thread still blocks for each step. A dedicated simulation worker would hide it from the frame, at the price of a real transport and snapshot protocol.
4. **Thread the native-world pool.** `loadNativeWorldPool` uses the single-threaded artifact; its registry calls are not qualified for simultaneous calls from several threads.
5. **Deployment headers** in `deploy/railway/Caddyfile`, and a Dockerfile check that `public/box3d/` is staged, if threads are wanted on the deployed site ([§6](#6-deployment)).
6. **Explain the two Node hazards.** Repeat the soak on another Node version, and capture a second crash report before filing upstream.
7. **Cross-engine determinism**: run `npm run test:threaded` logic in Firefox and Safari builds that expose shared memory.
8. **A GPU-resident rigid-body solver** is the only route identified toward a 100× capacity claim, restricted to a narrow shape set and isolated from this engine. It is research and has not been started.
