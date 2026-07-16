# v1.12 UI hot-path benchmark

Exact v1.11 archive SHA-256: `7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537`.

The cinematic camera sampler now writes into the existing camera rig and directly selects the built-in five-key track segment instead of allocating a rig/target vector and scanning earlier keys every active director frame. 123,030 samples matched the archived v1.11 output exactly. The public allocating wrapper retains its identity semantics.

| Workload | Baseline median | Candidate median | Speedup | 95% bootstrap interval | Min batch |
|---|---:|---:|---:|---:|---:|
| director-interior-track | 44.374 ms | 39.402 ms | **1.126×** | 1.113–1.136× | 38.4 ms |
| director-60hz-tour | 53.013 ms | 51.171 ms | **1.035×** | 1.023–1.047× | 49.9 ms |
| endpoint-and-clamp-sampling | 67.011 ms | 52.718 ms | **1.271×** | 1.256–1.285× | 51.7 ms |

Geometric mean: **1.140×**; minimum workload: **1.035×**. Gate: **PASS**.

## Reviewed but not changed

- A stateful monotonic-segment cache was piloted and removed: it regressed randomized interior sampling to 0.990× and reached only 1.023× on the 60 Hz tour trace. Direct five-key selection was faster and simpler.
- Camera shake already returns a shared constant while idle. The active-shake allocation is inside `src/effects.ts`, which was intentionally outside this audit's edit scope.
- The renderer's per-frame `resize()` call is guarded by exact dimensions before any texture work; there is no duplicate resize call in `src/main.ts`.
- Stats update only five times per second, and its changing timing fields make broad DOM-write suppression a low-value, harder-to-prove frame optimization.
- The duplicate category-filter listener is a setup-time bug, not a frame hot path; changing its event-observable call count was excluded from the exact-behavior optimization.
