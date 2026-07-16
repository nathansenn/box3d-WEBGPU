# Native Box3D lazy replay-hash benchmark

This benchmark isolates the exported `b3w_sync_transforms` bridge path. It is not a whole-physics-frame or GPU benchmark.

## Result

| Scenario | Pre-change | Lazy hash | Result |
|---|---:|---:|---:|
| Sync only | 0.304918 ms | 0.024271 ms | **12.56x faster** |
| Hash every 12 syncs | 0.309447 ms | 0.051049 ms | **6.06x faster** |
| Hash every sync | 0.311993 ms | 0.338875 ms | **8.6% slower** |

## Correctness

- Bodies: 4096
- Matrix floats compared bit-for-bit: 65536
- Exact matrix bits: true
- Matching replay hash: `3378806748`

## Method

- 15 timed samples per artifact
- Alternating baseline-first / optimized-first measurement order
- 48 warm-up syncs before each scenario
- Scene 3, stress 5, seed `0x515151`
- Host: Apple M3 Ultra; darwin/arm64; Node v26.0.0

## Baseline provenance

The pre-change binary is bundled as the benchmark-only fixture at `benchmarks/baselines/native-v1.10-lazy-hash`. It is not loaded by the application. The script requires these identities:

- `box3d.js`: `116e03dfee941b27fc9801dc598a21c4af1f1c2e32571f9777493bd8c7a81dff`
- `box3d.wasm`: `e9ae9984286b3549719443294fe1a18e9067391da2afc93a2cd783aa56117c3c`

Run:

```bash
node benchmarks/native-lazy-hash.mjs
```

The hash-every-sync control is intentionally retained. Lazy hashing only helps when replay-hash requests are less frequent than transform synchronization; it can regress when callers immediately request a hash after every sync.
