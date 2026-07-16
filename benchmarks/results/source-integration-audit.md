# Source Integration Audit

Changed implementation/configuration files: **27**

Source files: **11** · WASM files: **1** · scripts: **12**

Line delta: **+5379 / -622**

| File | Added | Deleted | Baseline | Optimized |
|---|---:|---:|---|---|
| `package-lock.json` | 6 | 6 | 29ff6f6455b4 | 79364d84389b |
| `package.json` | 23 | 6 | 326129783968 | 6e8672b75a4f |
| `scripts/build-soft-kernels.sh` | 93 | 0 | new | ee4118a1ef3d |
| `scripts/compile-turboquant-benchmarks.mjs` | 12 | 0 | new | 3234985a3308 |
| `scripts/generate-source-manifest.sh` | 54 | 0 | new | 250d1d70284c |
| `scripts/publish-github.sh` | 7 | 2 | f9b645e854b4 | 3f8f9d32f407 |
| `scripts/push-existing-box3d-webgpu.sh` | 4 | 5 | 1e14bbcccfc2 | 85a1048b355c |
| `scripts/self-test.mjs` | 85 | 6 | 79d50d19cb86 | b27cef9d6352 |
| `scripts/soft-kernel-integration-test.cjs` | 81 | 0 | new | 1a081322d0bd |
| `scripts/soft-kernel-test.mjs` | 308 | 0 | new | 0ae8835a78f6 |
| `scripts/soft-simulation-soak.cjs` | 44 | 10 | f3e6985cfa08 | 10775263127f |
| `scripts/verify-source-manifest.sh` | 45 | 0 | 2c86a9347bdd | 34694350d0ba |
| `scripts/webgpu-pipeline-test.mjs` | 154 | 18 | 5bdfafb9783e | c8e5b8fadb4f |
| `scripts/webgpu-renderer-runtime-test.mjs` | 153 | 12 | 36e8bee20b3c | 2967a6e4aa15 |
| `src/assets/ktx2.ts` | 174 | 0 | new | 8d9074f9414a |
| `src/compression/turboquant.ts` | 638 | 0 | new | 161d2d02298f |
| `src/main.ts` | 179 | 11 | eda0e3989d45 | f37da85be548 |
| `src/physics/fallback.ts` | 92 | 3 | c40b4663634e | 6ada1d700c66 |
| `src/physics/wasm.ts` | 4 | 1 | eabdf745feeb | acf105aa93be |
| `src/soft/kernels.ts` | 421 | 0 | new | 60cbbb95ba89 |
| `src/soft/packed-surface.ts` | 38 | 0 | new | d2e293c01e92 |
| `src/soft/simulations.ts` | 1337 | 439 | 0be4b7018463 | 3aae5efc30d1 |
| `src/types.ts` | 46 | 4 | 7468dc8b7ad8 | a20204174ef2 |
| `src/webgpu-minimal.d.ts` | 9 | 1 | 6a033fddf95d | 95dc6bd1fee8 |
| `src/webgpu/renderer.ts` | 874 | 98 | 4f9d4542d5ac | c09e908769ff |
| `tsconfig.benchmark.json` | 18 | 0 | new | c8dc31ee581e |
| `wasm/soft_kernels.c` | 480 | 0 | new | 19dc12cb1c64 |
