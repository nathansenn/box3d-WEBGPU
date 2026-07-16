# v1.8 Architecture Reconstruction Record

## Why this document exists

The project request referenced an earlier ChatGPT conversation that described a Box3D/WebGPU release through v1.8.0. The corresponding v1.8 archive, patch, and release commit were not available in the local workspace or configured GitHub repository. The newest verifiable source package available for integration was v1.4.0 plus the repository's v1.4.1 camera-orientation hotfix.

Version 1.8.1 therefore **reconstructs the described architecture** on that verified source. It is not presented as a byte-for-byte recovery of an unavailable artifact.

## Implemented from the described architecture

- Persistent standalone WebAssembly memory for selected cloth, rope, and water kernels.
- SIMD and scalar WASM variants with JavaScript fallback.
- Intact-cloth GPU surface reconstruction from positions and strain.
- Shallow-water GPU surface reconstruction from `eta`, `u`, and `v`.
- Topology-aware packed fallback for tearing cloth.
- Rope segment matrix and tension-color generation in WASM.
- `frameVersion`, topology, buffer-identity, and soft-instance upload caches.
- Dawn validation for packed/GPU cloth and water paths.
- Repeated-frame assertions that unchanged surface and soft-instance streams write zero additional bytes.
- Preservation of KTX2 assets, optional TurboQuant transport, 750 scenes, 30 hero sequences, HDR/MSAA/shadows/post, and the camera-orientation fix.

## Claims intentionally not inherited

The old conversation included benchmark ratios from environments and artifacts that are not available here. Those ratios are historical context, not current release evidence. This repository does not claim:

- a universal browser FPS multiplier;
- physical-GPU timing on the target Mac;
- byte identity with the unavailable v1.8 package;
- native upstream Box3D Emscripten execution unless `build:wasm` is run locally;
- that WebGPU executes the cloth/rope/water numerical solver.

Current performance claims should come from fresh runs of this source on the target device. The existing historical performance documents remain labeled by their original version.

## Reproducible verification

```bash
npm ci
npm run validate:v1.8
```

Focused gates:

```bash
npm run verify:soft-kernels
npm run test:soft-kernels
npm run test:webgpu
npm run test:soft-soak
npm run test:soft-soak:wasm
npm run build
npm run build:pages
```

The native rigid-body backend is a separate gate:

```bash
npm run fetch:box3d
npm run build:wasm
```

## Preserved camera correction

The final presentation shader must sample with:

```wgsl
let uv = vec2<f32>(input.uv.x, 1.0 - input.uv.y);
```

That one presentation flip remains isolated from the camera rig, view matrix, projection, shadow transform, and world-space physics.
