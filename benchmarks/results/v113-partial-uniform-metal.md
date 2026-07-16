# v1.13 partial scene-uniform Metal qualification

## Decision

**NO-GO.** Keep the current full 208-byte scene-uniform write. Neither partial-upload variant cleared the predeclared `1.03×` static-camera speedup requirement, and the 16-byte variant did not clear the conservative moving-camera no-regression floor.

## Source integrity

- Renderer baseline SHA-256: `7c6553969ec5586b5721c5d524d4be74f46608c06adff232aaa2d902bf2a5a9e`
- Four-byte time-only candidate: `c7a6c397dbbd3576c4bd7cb832c6cf85c4631ecb6299f8d53aa01fbf763b3959`
- Sixteen-byte camera/time candidate: `a433948c26c3a1889542311729c9e1f68a397a0d090b17c953c87db1362de571`
- KTX2 loader SHA-256: `8d9074f9414a508459644205f288b8d1fc7840d76017eb87096555efbcc32ca6`
- The variants were mechanically generated in a temporary directory. No renderer source was changed by this experiment.

## Method

- Apple Metal through Dawn/node-webgpu on a shared `GPUDevice`.
- Actual production sequence per measured frame: scene-uniform update, render command encoding, and submission.
- 31 paired batches with alternating AB/BA order and 100 frames per batch.
- `GPUQueue.onSubmittedWorkDone()` closed every timed batch.
- Cache comparisons, cache updates, resize checks, command encoding, submission, and GPU completion were included.
- Resolution was 320 × 180 with 1× sampling and shadows disabled to emphasize CPU/queue overhead while retaining the real frame path.
- The identity control used two independently transpiled, byte-identical renderer modules.
- Output was read back after both a static-camera partial-write sequence and a moving-camera full-write sequence.

## Results

| Variant | Workload | Baseline median | Candidate median | Speedup | Paired 95% interval | Verdict |
|---|---|---:|---:|---:|---:|---|
| Byte-identical control | Static camera | 0.4464 ms | 0.4428 ms | 1.0022× | 0.9760–1.0279× | Control |
| Byte-identical control | Moving camera | 0.4471 ms | 0.4403 ms | 1.0030× | 0.9767–1.0297× | Control |
| 4-byte time write | Static camera | 0.4328 ms | 0.4385 ms | **0.9881×** | 0.9630–1.0144× | Reject: below 1.03× |
| 4-byte time write | Moving camera | 0.4565 ms | 0.4435 ms | 1.0346× | 0.9982–1.0857× | No stable regression |
| 16-byte camera/time write | Static camera | 0.4497 ms | 0.4467 ms | **0.9934×** | 0.9303–1.0522× | Reject: below 1.03× |
| 16-byte camera/time write | Moving camera | 0.4446 ms | 0.4354 ms | 0.9908× | 0.9474–1.0256× | Conservative floor not cleared |

The baseline writes 208 bytes per call. The static variants write 4 or 16 bytes after comparing cached fields; moving-camera frames fall back to the full 208-byte write. The smaller transfers did not translate into a reliable complete-frame gain because the queue-call and comparison costs dominate this tiny payload.

## Exactness

All baseline/candidate readbacks were byte-identical with zero uncaptured WebGPU errors.

- Static output SHA-256: `fd1796ad652d2f74c39c215df997845a8fa62373abd58becf0e026cfd3380414`
- Moving output SHA-256: `d54a73097b8917211a5e321baacdd913e93edc6ecf96b7496b85b41598a27bfa`
- Differing bytes: `0`
- Maximum channel error: `0`

## Excluded pilot

A queue-only pilot issued tens of thousands of writes without intervening frame submissions. Metal/Dawn exhibited buffer-specific queue throttling even for byte-identical modules, so those measurements were rejected as non-production behavior and are not present in the evidence JSON or any result above.

Machine-readable evidence: `benchmarks/results/v113-partial-uniform-metal.json`.
