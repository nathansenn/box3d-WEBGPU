# Native v1.10 rigid-stream baseline fixture

These are the exact native Box3D artifacts immediately before move-event
transform streaming and independent material revisions were introduced. They
are benchmark fixtures only; the application loads `public/box3d/`.

The fixture uses Box3D `v0.1.0` commit
`8441b4a06d6d09dcfb0b0f704df4d847d1437b92` and Emscripten 4.0.23.

| File | Bytes | SHA-256 |
|---|---:|---|
| `box3d.js` | 13,951 | `116e03dfee941b27fc9801dc598a21c4af1f1c2e32571f9777493bd8c7a81dff` |
| `box3d.wasm` | 396,706 | `451c570fa960ea66bd7ee5f3bd98d6166d2945da1b8930e446c8ac5a8a0a7db6` |

Run `node benchmarks/native-rigid-stream.mjs` from the repository root.
