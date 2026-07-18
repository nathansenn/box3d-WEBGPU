# Renderer hot-path Metal benchmark

Generated: 2026-07-15T09:46:08.656Z

## Scope and integrity

- Backend: **metal** on darwin/arm64
- Resolution: **1920 × 1080**, 4× MSAA, 2048² shadow map
- Material texture: **ktx2-bc4** (43704 payload bytes)
- Baseline and variant renderer modules share one Metal `GPUDevice` to remove cross-device offsets.
- Exact archived v1.10 renderer: `e12869557c9809cdf562fc5ead456121ac189013793b0b15c6236f2a4793e240`
- Workspace renderer at measurement: `e12869557c9809cdf562fc5ead456121ac189013793b0b15c6236f2a4793e240` (exact-v1.10)
- Candidate-source isolation: **passed** (mechanically derived from the exact archive: 4 PCF moves, 5 fog rewrites, and 1 depth-store change).
- Timing: 21 alternating paired batches × 100 frames; every batch ends with `queue.onSubmittedWorkDone()`.

## Candidate verdicts

| Candidate | Changed-path speedup | Paired 95% interval | Controls | Fidelity | Decision |
|---|---:|---:|---:|---:|---|
| pcf-center-sample | 0.9778× | 0.9242–1.0344 | 1.0644× [0.9940, 1.1397] | pass | **revert-no-stable-benefit** |
| squared-distance-fog | 1.0271× | 0.9862–1.0686 | n/a | pass | **revert-no-stable-benefit** |
| hdr-depth-discard | 1.0212× | 0.9812–1.0651 | n/a | pass | **revert-no-stable-benefit** |
| three-edit-combined-candidate | 0.9961× | 0.9664–1.0275 | n/a | pass | **revert-no-stable-benefit** |

## Per-workload results

| Candidate | Scene | Taps | Role | Baseline ms | Variant ms | Speedup | Paired 95% interval | Max pixel error | RMSE |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| pcf-center-sample | rigid | 1 | control | 0.5412 | 0.5048 | 1.0644× | 0.9941–1.1403 | 0 | 0.000000 |
| pcf-center-sample | rigid | 9 | changed | 0.5432 | 0.4806 | 1.0574× | 0.9611–1.1660 | 0 | 0.000000 |
| pcf-center-sample | cloth | 9 | changed | 0.4986 | 0.4828 | 1.0295× | 0.9359–1.1192 | 0 | 0.000000 |
| pcf-center-sample | water | 9 | changed | 0.4445 | 0.5204 | 0.8589× | 0.7937–0.9361 | 0 | 0.000000 |
| squared-distance-fog | rigid | 1 | changed | 0.4985 | 0.4898 | 1.0265× | 0.9557–1.1074 | 0 | 0.000000 |
| squared-distance-fog | cloth | 1 | changed | 0.4836 | 0.4679 | 0.9948× | 0.9284–1.0596 | 1 | 0.000491 |
| squared-distance-fog | water | 1 | changed | 0.5168 | 0.4759 | 1.0611× | 0.9912–1.1322 | 0 | 0.000000 |
| hdr-depth-discard | rigid | 1 | changed | 0.4842 | 0.5067 | 1.0012× | 0.9331–1.0866 | 0 | 0.000000 |
| hdr-depth-discard | cloth | 1 | changed | 0.5244 | 0.4787 | 1.0689× | 1.0146–1.1298 | 0 | 0.000000 |
| hdr-depth-discard | water | 1 | changed | 0.4898 | 0.4759 | 0.9951× | 0.9230–1.0727 | 0 | 0.000000 |
| three-edit-combined-candidate | rigid | 1 | changed | 0.4263 | 0.4913 | 0.9180× | 0.8555–0.9890 | 0 | 0.000000 |
| three-edit-combined-candidate | cloth | 1 | changed | 0.5067 | 0.4791 | 1.0770× | 1.0174–1.1364 | 1 | 0.000491 |
| three-edit-combined-candidate | water | 1 | changed | 0.4789 | 0.4244 | 1.0715× | 0.9792–1.1774 | 0 | 0.000000 |
| three-edit-combined-candidate | rigid | 9 | changed | 0.4328 | 0.4800 | 0.9990× | 0.9289–1.0815 | 0 | 0.000000 |
| three-edit-combined-candidate | cloth | 9 | changed | 0.4625 | 0.4831 | 0.9358× | 0.8900–0.9815 | 1 | 0.000491 |
| three-edit-combined-candidate | water | 9 | changed | 0.4489 | 0.4532 | 0.9865× | 0.9194–1.0537 | 0 | 0.000000 |

## Interpretation

- **pcf-center-sample: revert-no-stable-benefit.** The measured effect did not clear the predeclared stable-benefit gate.
- **squared-distance-fog: revert-no-stable-benefit.** The measured effect did not clear the predeclared stable-benefit gate.
- **hdr-depth-discard: revert-no-stable-benefit.** The measured effect did not clear the predeclared stable-benefit gate.
- **three-edit-combined-candidate: revert-no-stable-benefit.** The measured effect did not clear the predeclared stable-benefit gate.

The measurements use the actual production `WebGPURenderer` source transpiled directly from the archived baseline and mechanically derived variants. Wall time includes JavaScript command encoding, submission, Metal execution, and queue completion; it is intentionally not represented as a pure shader timestamp.

## Reproduce

```bash
RENDERER_HOTPATH_CANDIDATES=pcf-center-sample,squared-distance-fog,hdr-depth-discard,three-edit-combined-candidate \
RENDERER_HOTPATH_WARMUPS=100 \
RENDERER_HOTPATH_BATCHES=21 \
RENDERER_HOTPATH_FRAMES_PER_BATCH=100 \
RENDERER_HOTPATH_OUTPUT=renderer-hotpath-metal \
node benchmarks/renderer-hotpath-metal.mjs
```

Environment overrides: `RENDERER_HOTPATH_WIDTH`, `RENDERER_HOTPATH_HEIGHT`, `RENDERER_HOTPATH_WARMUPS`, `RENDERER_HOTPATH_BATCHES`, `RENDERER_HOTPATH_FRAMES_PER_BATCH`, and `RENDERER_HOTPATH_BOOTSTRAPS`.
