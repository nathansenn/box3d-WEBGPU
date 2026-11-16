# Versions and API stability

What a version number of `box3d-webgpu-kit` promises from 1.0.0 on, what is outside the promise, and how a change is
checked. Until 1.0.0 is published (the release candidate is 1.0.0-rc.1), minor versions may still change the API; the
changelog lists every such change.

## What is the public API

- Every name exported from a documented entry point (`box3d-webgpu-kit` and its subpaths in `package.json`
  `exports`), with the types in the published `.d.ts` files. `packages/box3d-kit/api/public-api.txt` is the reviewed
  listing; a test fails when the build's declarations differ from it, so no change to the surface lands unseen.
- The scene format (`box3d-scene`, versions 1 and 2), the share-link format (`b3s1`), the replay log (versions 1
  and 2) and the checkpoint container (its format version is in every file).
- The error codes of `ENGINE_ERRORS` ([errors and diagnostics](ERRORS.md)) and the rule names of `diagnose()`.
- The accepted ranges of `RIGID_LIMITS`.

Not public API, and free to change in any release: anything under `dist/core/` that an entry point does not
re-export; members marked `@internal` or starting with `_`; the WebAssembly exports (`_b3w_*`) and the layout of the
instance buffers beyond what `matrices()` and `colors()` document; error message wording (switch on `code`); the
exact text of `canonicalize` for a new scene version; private fields that TypeScript hides but JavaScript can reach.

## Semantic versioning

| Change | Version |
| --- | --- |
| A fix that keeps every documented behaviour | patch |
| A new export, option, scene section, error code or `diagnose()` rule; a new optional field in a result | minor |
| A new WebAssembly build of the same Box3D API (results may differ in the last bits) | minor, and stated in the changelog |
| Removing or renaming an export; changing a signature, a default, a unit or the meaning of a result; narrowing an accepted range; removing an error code | major |
| Reading an older scene, link, replay or checkpoint version stops working | major |

Numerical results are part of the contract in a specific sense:

- **Same build, same bits.** With the same `BUILD_INFO.wasmSha256`, the same calls give bit-identical results.
  Replays and checkpoints rely on it and check it (`INCOMPATIBLE_SAVE`, `CHECKPOINT_MISMATCH`).
- **Across versions, within tolerance.** A patch or minor release may change results by rounding or by a better
  method, but every case of the validation registry (592 cases at the time of writing) still passes its stated
  tolerance; a result that moves beyond a published tolerance is a breaking change. A changed WebAssembly is named in
  the changelog, because saved replays and checkpoints of the old build no longer apply.
- **Hashes.** The scene, example and recipe hashes pinned by the tests change only when the changelog says which and
  why.

## Deprecation

A public name is deprecated before it is removed: marked `@deprecated` in its doc comment with the replacement,
listed in the changelog, kept working for at least one minor release, and removed only in a major one. Deprecated
now: `RaycastOptions` (use `QueryOptions`).

## Supported platforms

- Node.js 20 or later; current Chrome, Edge, Firefox and Safari. ES modules only.
- WebAssembly with `BigInt` integration (64-bit handles). No threads or SIMD are required; `loadBox3D({threads})`
  loads the separate pthread build (`wasm/box3d-mt.*`), which needs a cross-origin isolated page.
- Bundlers: tested with Vite, and without a bundler from a static path by a plain `<script type="module">`. The
  package is side-effect free (`sideEffects: false`); the main entry loads no solver module, and a bundle that uses
  only the rigid world is 37.6 KiB of gzip. webpack 5 is not tested here (it is not installed in this repository);
  the package uses only standard ES modules and `new URL(file, import.meta.url)` for its WebAssembly, which webpack 5
  supports.
- three.js and Babylon.js are optional peers of the `/three` and `/babylon` adapters; nothing else is needed at run
  time.

## How a change is checked

`npm run validate:pr` runs, among others: the API listing test; the validation registry against its tolerances; the
fuzzers ([robustness](ROBUSTNESS.md)); `npm --prefix packages/box3d-kit run test:pack`, which packs the tarball,
installs it in an empty project, type-checks a strict consumer, runs the templates, checks each entry point's size
against its budget and that the rigid core pulls no solver; and the documentation build with its link check.
