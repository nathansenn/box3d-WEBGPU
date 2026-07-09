# Repository Summary

## Repo

`nathansenn/box3d-WEBGPU`

## Purpose

A maximum-value browser demo proving a practical architecture for Box3D-powered physics inside a WebGPU rendering stack.

## Highlights

- 600 generated physics scenes across 12 families.
- WebGPU instanced renderer and debug overlay.
- WASM bridge for upstream Box3D.
- Deterministic JavaScript fallback backend.
- Max Tour cinematic demo mode.
- In-browser smoke tests.
- Node/TypeScript test suite.
- GitHub Actions CI.
- GitHub Pages deployment workflow.

## Local commands

```bash
npm install
npm test
npm run build
npm run dev
```

## Publish command

```bash
bash scripts/publish-github.sh
```
