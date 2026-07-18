# Native v1.10 pre-lazy-hash benchmark fixture

This directory contains the preserved native Box3D WebAssembly module from immediately before replay hashing moved out of `b3w_sync_transforms()` and became lazy. It is a benchmark fixture only; the application loads the artifacts in `public/box3d/`.

The module was built from Box3D `v0.1.0` at commit `8441b4a06d6d09dcfb0b0f704df4d847d1437b92` with Emscripten 4.0.23. `BUILD_PROVENANCE.json` records its original toolchain and artifact metadata. `BOX3D_LICENSE.txt` is the matching upstream MIT license.

Required artifact identities:

| File | Bytes | SHA-256 |
|---|---:|---|
| `box3d.js` | 13,951 | `116e03dfee941b27fc9801dc598a21c4af1f1c2e32571f9777493bd8c7a81dff` |
| `box3d.wasm` | 396,622 | `e9ae9984286b3549719443294fe1a18e9067391da2afc93a2cd783aa56117c3c` |

Run the comparison from the repository root:

```bash
node benchmarks/native-lazy-hash.mjs
```

The script rejects a baseline whose hashes do not match these preserved artifacts.
