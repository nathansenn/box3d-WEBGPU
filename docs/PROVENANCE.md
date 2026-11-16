# Provenance and bill of materials

What the kit package (`box3d-webgpu-kit`) is made of, how to check it, and how to publish it with provenance. Nothing
here publishes anything: publishing is the owner's decision.

## What is in the tarball

| Part | Origin | How it is identified |
| --- | --- | --- |
| `dist/*.js`, `dist/*.d.ts` | this repository's `packages/box3d-kit/src` and the engine sources copied from `src/engine` by `scripts/sync-core.mjs` | the git commit; `api/public-api.txt` is the reviewed listing of the surface |
| `wasm/box3d.wasm`, `wasm/box3d.js` | Box3D `v0.1.0` (commit `8441b4a06d6d09dcfb0b0f704df4d847d1437b92`, MIT) and the bridge `wasm/box3d_web.c`, compiled with Emscripten 4.0.23 | `wasm/BUILD_PROVENANCE.json`: the Box3D ref and commit, the toolchain versions, the SHA-256 of the bridge source and of both artifacts. `sync-core.mjs` refuses to build the package when the bytes differ from it |
| the same identity, at run time | generated `dist/core/build-info.js` | `BUILD_INFO` (`wasmSha256`, `box3dCommit`, `emscripten`, `bridgeSha256`); `loadBox3D({integrity: true})` checks the loaded bytes against it and throws `INTEGRITY_MISMATCH` |
| `LICENSE`, `THIRD_PARTY_NOTICES.md`, `wasm/BOX3D_LICENSE.txt` | this repository; Box3D's license text | - |

## Bill of materials

Run-time dependencies: **none**. `package.json` has no `dependencies`. `three` and `@babylonjs/core` are optional
peers, used only by the `/three` and `/babylon` adapters, which import nothing from them.

Compiled into the WebAssembly: Box3D (MIT), Emscripten's system libraries including musl (MIT; Emscripten is MIT and
University of Illinois/NCSA). Compiled into the JavaScript: nothing from outside this repository.

Build-time tools (not shipped): TypeScript 5, Node.js 20 or later; Emscripten 4.0.23 and CMake for the WebAssembly.

A machine-readable bill of materials of the package as installed:

```bash
npm --prefix packages/box3d-kit run build
cd packages/box3d-kit && npm sbom --sbom-format cyclonedx --omit dev > box3d-webgpu-kit.cdx.json
```

With no dependencies the document lists the package itself; the WebAssembly's inputs are in `BUILD_PROVENANCE.json`,
which an SBOM tool does not read.

## Reproducing the WebAssembly

```bash
npm run fetch:box3d        # the pinned Box3D source into third_party/
npm run build:wasm         # needs Emscripten 4.0.23; writes public/box3d/ and BUILD_PROVENANCE.json
npm run test:cbridge
```

The build is reproducible in the sense that the same toolchain versions give the same bytes; `BUILD_PROVENANCE.json`
records them. A different Emscripten or CMake gives different bytes and therefore a different `wasmSha256`.

## Publishing with npm provenance

From a GitHub Actions workflow with `id-token: write`, `npm publish --provenance --access public` attaches a signed
statement that links the tarball to the commit and the workflow that built it. This repository's rule is that CI
never writes and holds no secrets (AGENTS.md), so no such workflow exists; adding one is a deliberate change for the
owner. Before a first publish:

1. `npm --prefix packages/box3d-kit run test:pack` (sizes, exports, types, templates, a browser load from a static path).
2. Check `npm pack --dry-run` for the file list.
3. Take or drop the prepared version commit (`1.0.0-rc.1`); tag it; publish with `--tag next` for a release candidate.
