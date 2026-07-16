# v1.9 Semantic Integration

## Status

**Integrated source: full manifest-sealed `npm run validate:v1.9` passed on July 14, 2026.**

This repository does not treat the supplied v1.9 archive as a drop-in replacement. The archive was verified as:

```text
box3d-WEBGPU-AAA-edition-1.9.0-fifth-breakthrough-validated.zip
SHA-256 09fa0eec3db1858d57cdc58a9fe8f021b76cd6c19c5b8913eb9d55e1667a1fbb
```

Its source is descended from the supplied original v1.8.0 line. The current repository instead contains the independently reconstructed v1.8.1 architecture documented in [`RECONSTRUCTION_V1.8.md`](RECONSTRUCTION_V1.8.md), including a different soft-kernel loader/ABI and fixes made after that historical line. Applying the archive wholesale would discard those changes.

The v1.9 work was therefore ported semantically through a manual three-way integration:

```text
verified v1.9 archive intent
             +
current reconstructed v1.8.1 contracts and fixes
             ↓
manual v1.9 integration in this repository
```

The v1.4.1 presentation correction remains intact: the final post-process shader flips the resolved HDR texture's V coordinate exactly once. The v1.9 integration does not change camera, projection, shadow, or world-space physics conventions.

## Integrated behavior

### Adaptive intact-cloth projection

Intact cloth now uses scene-structural projection ceilings:

| Recipe class | Maximum projection passes |
|---|---:|
| Perimeter-pinned membrane drum (`variant === 9`) | 4 |
| Hammock/collider drape (`variant === 3`) | 6 |
| Other intact cloth | 8 |
| Tearing cloth | Full authoritative schedule |

The current soft-kernel ABI projects one compact constraint stream. The manual port preserves that ABI and compensates per-pass stiffness when reducing the intact-cloth pass count. It does not replace the current loader or packaged SIMD/scalar fallback chain with the archive's loader.

### Position-only dynamic cloth traffic

An intact GPU-cloth frame now publishes:

```text
current positions       float32 xyz · 12 dynamic bytes/vertex
immutable rest pose     float32 xyz · uploaded on identity/topology change
indices                 uint16 · uploaded on topology change
```

WebGPU derives visual strain from current and rest positions while reconstructing normals, material color, woven response, and shadow position. The legacy strain array remains available for diagnostics and topology-aware tearing compatibility, but it is not part of the intact cloth's steady dynamic upload.

Tearing cloth still uses the 24-byte packed CPU surface. Mutable topology and disconnected triangles remain a deliberate correctness boundary.

### Compact GPU rope expansion

Rope rendering now publishes two streams:

```text
node positions          float32 xyz per node
segment metadata        8 × float32 per active segment
                        nodeA, nodeB, inverseRestLength, radius,
                        colorR, colorG, colorB, colorA
```

Segment metadata changes only when rope topology changes. A WebGPU compute pass expands the compact node/segment data into the renderer's existing model-matrix and material streams. Payloads, projectiles, rigid bodies, and effects continue to use the shared instance path.

This compute pass is render preparation only. Rope PBD, cloth PBD, shallow-water stepping, collision selection, and break bookkeeping remain CPU/JavaScript or CPU/WebAssembly work.

## Preserved v1.8.1 behavior

- Current SIMD → scalar → JavaScript soft-kernel selection and memory ownership.
- Topology-aware tearing-cloth fallback.
- GPU-resident shallow-water reconstruction from `eta/u/v`.
- Whole-system projectile broad rejection.
- Unchanged-frame and topology upload caching.
- The zero-length rope tension/orientation guard.
- The final post-process V flip exactly once.
- The v1.8.1 reconstruction provenance and its evidence policy.

## Validation target

The integrated release gate is:

```bash
npm run validate:v1.9
```

It is intended to cover source integrity, TypeScript and Node tests, all JavaScript/SIMD/scalar soft soaks, Dawn shader/pipeline/runtime checks including GPU rope compute, the supplied benchmark-evidence gate, production build, Pages build, and a final source-integrity check.

The complete integrated gate passed with 139 manifest entries, 16 deterministic unit suites, byte-identical SIMD/scalar kernel rebuilds, 12 Dawn shaders, the actual renderer runtime, three 150-scene soft soaks, the supplied-evidence consistency gate, and both production builds. Checks performed only against the supplied archive remain distinct from this manually merged tree.

## Supplied benchmark evidence: interpretation limits

The supplied v1.9 archive contains benchmark reports and result files. They are useful reference evidence, with four important limits:

1. They describe the archive's exact-release lineage, not this manually integrated v1.8.1-derived tree.
2. `bench:fifth:gate` verifies recorded result artifacts; it is not itself a fresh benchmark rerun.
3. Some supplied cases are noisy or report high median absolute deviation, so isolated ratios should not be generalized.
4. The evidence measures CPU simulation/frame preparation and upload accounting. It does not prove physical-GPU duration, visible-browser correctness, or a universal FPS increase.

Fresh integrated comparisons require the benchmark commands to be rerun on this tree and reported with device, runtime, sample count, median, and dispersion. Target-browser GPU/FPS claims additionally require physical-device profiling and visual acceptance.

## Fresh original-baseline result

The manual integration was compared separately with the bundled v1.2.0 source, the earliest reproducible full cloth/rope/water baseline. Nine isolated processes per variant/workload on an Apple M3 Ultra produced a **6.224×** geometric-mean improvement for the preferred SIMD/WASM path and **3.651×** for JavaScript-to-JavaScript. Maximum-detail SIMD/WASM results were 7.309× cloth, 2.459× rope, and 13.416× water, with zero correctness failures and 0.068–0.229% relative L2 state difference against the 0.5% gate.

This is a CPU simulation plus CPU handoff comparison. It excludes WebGPU execution time, physical-GPU FPS, and native Box3D rigid-body performance. Full methodology and raw samples are in [`../benchmarks/results/original-v1.2-v1.9.md`](../benchmarks/results/original-v1.2-v1.9.md) and [`../benchmarks/results/original-v1.2-v1.9.json`](../benchmarks/results/original-v1.2-v1.9.json).
