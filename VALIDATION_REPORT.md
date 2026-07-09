# Validation Report — Box3D WebGPU Maximum Lab

Date: 2026-07-08

## Package

`box3d-WEBGPU` v0.3.0

## What changed

- Expanded from 6 flagship scenes to **600 procedural examples**.
- Added 12 physics capability families with 50 scenes each.
- Added searchable/filterable scene browser.
- Added scene selector, prev/next/random navigation, and featured scene buttons.
- Added **Max Tour** mode that cycles through high-value scenes and triggers automatic actions.
- Updated JS fallback physics backend with scene recipes for all 12 families.
- Updated Box3D C/WASM bridge scene mapping for all 12 catalog families.
- Updated browser smoke tests for the full scene catalog.
- Updated Node tests for 600-scene catalog integrity.

## Commands run

```bash
npm install
npm test
npm run build
```

## Results

```text
npm install: 0 vulnerabilities
npm test: passed
npm run build: passed
```

## npm test details

Passed suites:

- Math/matrix utilities.
- 600-scene catalog integrity.
- Fallback backend can create every scene.
- Featured scenes can step without invalid matrices.
- Determinism for identical seed and scene.
- Runtime actions: kick, explosion, projectile, rain.
- Repository self-test for bridge/API export alignment.

## Notes

The real Box3D WASM artifact still requires a local Emscripten environment and the upstream Box3D source cloned into `third_party/box3d`.

The JS fallback backend is intentionally a preview/test backend. The serious physics path is still Box3D through WASM.
