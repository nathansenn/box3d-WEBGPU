# Validation Report — Box3D WebGPU AAA Physics Lab

**Date:** 2026-07-10  
**Package:** `box3d-webgpu` v1.0.0  
**Target repository:** `nathansenn/box3d-WEBGPU`

## Scope validated

This report covers the source archive delivered with the project. It validates
its deterministic simulation preview, authored demonstration data, WebGPU
source contracts, native bridge surface, build configuration, documentation,
and production bundle.

It does **not** claim that the generated Box3D WebAssembly files are included.
Those artifacts are intentionally produced locally with Emscripten by running
`npm run fetch:box3d` and `npm run build:wasm`.

## Commands executed

```bash
npm run doctor
npm run validate
npm run build:pages
npm audit --audit-level=moderate
```

A strict native bridge syntax pass was also run with Clang in C17 mode against
a compatibility header matching the Box3D API surface used by the bridge:

```bash
clang -std=c17 -Wall -Wextra -Wpedantic -Werror \
  -fsyntax-only -I/path/to/box3d-api-stub/include wasm/box3d_web.c
```

## Results

| Gate | Result |
|---|---|
| Source SHA-256 manifest verification | Passed |
| Strict TypeScript typecheck | Passed |
| Deterministic Node test suites | 9 / 9 passed |
| Generated scene constructors | 600 / 600 passed |
| Authored hero timeline validation | 24 / 24 passed |
| Catalog and cinematic camera-elevation regression checks | Passed |
| AAA set-dressing checks | Passed |
| Matrix finiteness and fixed-step checks | Passed |
| Replay determinism checks | Passed |
| Cinematic effects/emissive-data checks | Passed |
| Native bridge/build/UI repository contracts | Passed |
| Production Vite bundle | Passed |
| GitHub Pages subpath bundle | Passed |
| npm moderate-or-higher audit | 0 vulnerabilities found |
| C17 bridge syntax with warnings as errors | Passed |

The final production build produced a compact browser bundle and completed
without TypeScript or Vite errors.

## Native Box3D integration review

The bridge and CMake wrapper were checked for:

- Box3D world/body/shape creation through the public C API;
- fixed-step world advancement and transform streaming;
- stable exported C ABI used by the TypeScript backend;
- modular ES-module Emscripten output;
- WebAssembly SIMD by default;
- heap growth with refreshed typed-array views;
- Box3D linked as a CMake subproject through `box3d::box3d`;
- normal, non-force repository publishing workflow.

The bridge source passes strict C17 parsing. An actual `emcc` compile could not
be executed in this environment because the Emscripten SDK and fetched Box3D
source are not installed in the artifact sandbox. The package includes the
exact reproducible commands for that final native build.

## Browser-render validation boundary

The Vite preview server responded successfully over HTTP. However, the managed
Chromium installation in this sandbox applies an organization policy that
blocks every URL, including localhost and `file://`. As a result, this
environment could not perform an honest rendered-frame WebGPU check or click
the in-app **Run 600 + 24 Browser Tests** control.

No browser-runtime success is claimed here. The required local rendered-frame
procedure is documented in
[`docs/LOCAL_BROWSER_VALIDATION.md`](docs/LOCAL_BROWSER_VALIDATION.md). It
covers WGSL compilation, adapter/device creation, the four quality modes, all
24 hero sequences, all 600 recipes, native-backend selection, and the Pages
bundle.

## Environment doctor status

The source package and deterministic preview backend are ready immediately.
The doctor correctly reports the following optional native prerequisites as
missing until they are installed/built:

- active Emscripten SDK;
- `third_party/box3d` checkout;
- `public/box3d/box3d.js`;
- `public/box3d/box3d.wasm`.

Those are expected warnings, not source-package failures.

## Final assessment

The delivered archive passes its static, deterministic, packaging, security,
and production-build gates. The remaining acceptance gate is the real-browser
render run on a machine whose browser policy permits localhost, followed by the
native Emscripten build and the same 624-scenario live smoke test with the
**Box3D WASM** backend active.
