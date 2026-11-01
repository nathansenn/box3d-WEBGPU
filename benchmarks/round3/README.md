# Round 3 — opt-in rigid-stream sparse uploads and 100 physical-GPU cases

**Status:** Review-only branch. Neither the new sparse path nor its GPU benchmark has been merged into production. Original shader, model detail and frame submission remain unchanged by default.

## What was applied

`planSparseRecordUpload` coalesces *authoritative* dirty record ranges, compares expected transfer and write-call cost against the intact stream, and falls back to a full upload when the sparse plan is unfavorable. Renderer `uploadInstances(source, count, dirty?)` accepts optional producer-owned revision evidence:

```ts
renderer.uploadInstances(source, count, {
  previousFrameVersion: previous.frameVersion,
  previousColorVersion: previous.colorVersion,
  frameVersion: source.frameVersion(),
  colorVersion: source.colorVersion(),
  matrices: [{ start: 512, count: 48 }],
  colors: [], // only when the material/color version changed and data is truly unchanged
  gapRecords: 0,
});
```

**Mandatory contract:** the producer must enumerate *every* changed record since the indicated previous revision. There is no safe way to derive complete dirty metadata by guessing from a camera or a few bodies. Omit `dirty` until the physics owner supplies exhaustive records. The renderer forces full uploads when the buffer's source, heap, count, offsets, or previous/current versions do not match. It does not turn sparse transfer on automatically.

This is source-ready experimental wiring, **not a proven renderer-wide speedup**. The prior continuation documented six sparse-upload wins under isolated synthetic conditions; another study identified qualified GPU-resident and visibility-envelope cases. Those results do not justify replacing production data paths or multiplying speedup ratios.

## 100-test Round 3 GPU plan

`benchmarks/round3/gpu-sparse-100.mjs` predeclares 100 conditions across ten families: contiguous, scattered, strided, clustered matrix changes; contiguous and scattered color changes; joint streams; dense update bursts; exact static controls; and missing-proof full-upload controls.

Every condition compares actual full and candidate GPU uploads with an identical offscreen instanced render. Two held-out input sets, 24 randomized AB/BA pairs of eight-frame complete windows per set, and image plus buffer readback parity are required. The primary duration includes CPU mutation/planning, GPU writes, encoding/submission and GPU queue completion. Pixel/buffer readbacks, compilation and buffer allocation are *outside* measured intervals.

The directional Holm family is **200 tests**, with qualification requiring both sets to show `>3%` median paired improvement, corrected `p <= 0.05` and candidate p95 window averages `<= 1.10×` baseline. There is no production FPS, display-latency, or cross-device claim. All regressions, unresolved conditions and invalid runs must remain in the saved report.

Worker must validate physical NVIDIA identity, native Vulkan adapter, GPU timestamps and exact outputs; save every case and source fingerprint in a **new isolated directory** under preserved volume `5ftxitn7ox`. The original campaign directories must remain unchanged. No raw results are declared exported until off-volume checksums are verified.

## Local correctness test

```bash
npm ci
npm run typecheck
npm test  # includes tests/sparse-upload.test.ts (100 deterministic record-replay cases)
```

The `gpu-sparse-100.mjs` runner additionally requires pinned Node 24.22.1 and native `webgpu@0.6.2` under `/workspace/benchmark-tools`. Run it only on a verified physical NVIDIA target with a strict hard deadline. Stop the exact new pod through the provider after final/error/deadline and verify EXITED.

### Safeguards

- This branch is **opt-in only**, and source-change hints are never inferred from untrusted index samples.
- No hardcoded quality reductions, shader replacement, visual geometry omission, or workaround of validation.
- Negative findings remain part of the result population; never multiply independent gains.
- Existing benchmark volumes, historical signatures and published results are not modified.
