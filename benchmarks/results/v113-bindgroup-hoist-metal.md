# Renderer hot-path Metal benchmark

Generated: 2026-07-16T19:04:14.061Z

## Scope and integrity

- Backend: **metal** on darwin/arm64
- Resolution: **1280 × 720**, 4× MSAA, 2048² shadow map
- Material texture: **ktx2-bc4** (43704 payload bytes)
- Baseline and variant renderer modules share one Metal `GPUDevice` to remove cross-device offsets.
- Exact archived v1.10 renderer: `7c6553969ec5586b5721c5d524d4be74f46608c06adff232aaa2d902bf2a5a9e`
- Workspace renderer at measurement: `54268ea35988123e714f16978e382c7a02f3490a48bf706d213194cb1778fd54` (other-workspace-state)
- Candidate-source isolation: **passed** (mechanically derived from the exact archive: 4 PCF moves, 5 fog rewrites, and 1 depth-store change).
- Timing: 9 alternating paired batches × 30 frames; every batch ends with `queue.onSubmittedWorkDone()`.

## Candidate verdicts

| Candidate | Changed-path speedup | Paired 95% interval | Controls | Fidelity | Decision |
|---|---:|---:|---:|---:|---|
| workspace-current | 1.0018× | 0.9273–1.0868 | 1.0143× [0.9771, 1.0598] | pass | **revert-no-stable-benefit** |

## Per-workload results

| Candidate | Scene | Taps | Role | Baseline ms | Variant ms | Speedup | Paired 95% interval | Max pixel error | RMSE |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| workspace-current | rigid | 1 | changed | 0.3198 | 0.3298 | 0.9904× | 0.8529–1.1629 | 0 | 0.000000 |
| workspace-current | cloth | 1 | control | 0.2547 | 0.2550 | 1.0397× | 0.9106–1.2174 | 0 | 0.000000 |
| workspace-current | water | 1 | control | 0.2277 | 0.2301 | 1.0186× | 0.9774–1.0693 | 0 | 0.000000 |
| workspace-current | rigid | 9 | changed | 0.2315 | 0.2316 | 1.0132× | 0.9872–1.0464 | 0 | 0.000000 |
| workspace-current | cloth | 9 | control | 0.2272 | 0.2280 | 0.9923× | 0.9763–1.0078 | 0 | 0.000000 |
| workspace-current | water | 9 | control | 0.2267 | 0.2260 | 1.0070× | 0.9630–1.0653 | 0 | 0.000000 |

## Interpretation

- **workspace-current: revert-no-stable-benefit.** The measured effect did not clear the predeclared stable-benefit gate.

The measurements use the actual production `WebGPURenderer` source transpiled directly from the archived baseline and mechanically derived variants. Wall time includes JavaScript command encoding, submission, Metal execution, and queue completion; it is intentionally not represented as a pure shader timestamp.

## Reproduce

```bash
RENDERER_HOTPATH_CANDIDATES=workspace-current \
RENDERER_HOTPATH_WARMUPS=30 \
RENDERER_HOTPATH_BATCHES=9 \
RENDERER_HOTPATH_FRAMES_PER_BATCH=30 \
RENDERER_HOTPATH_OUTPUT=v113-bindgroup-hoist-metal \
node benchmarks/renderer-hotpath-metal.mjs
```

Environment overrides: `RENDERER_HOTPATH_WIDTH`, `RENDERER_HOTPATH_HEIGHT`, `RENDERER_HOTPATH_WARMUPS`, `RENDERER_HOTPATH_BATCHES`, `RENDERER_HOTPATH_FRAMES_PER_BATCH`, and `RENDERER_HOTPATH_BOOTSTRAPS`.
