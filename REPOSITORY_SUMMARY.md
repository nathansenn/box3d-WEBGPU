# Repository Summary — Box3D WebGPU AAA Physics Lab

## Destination

```text
https://github.com/nathansenn/box3d-WEBGPU
```

## Mission

Prove a production-oriented browser architecture in which Box3D remains the authoritative rigid-body solver while WebGPU delivers a high-density, cinematic visualization and diagnostics layer.

## Delivered capability

| Layer | Included |
|---|---|
| Simulation | Fixed-step backend boundary, native Box3D C/WASM bridge, deterministic preview backend |
| Catalog | 600 repeatable recipes across 12 capability families |
| Hero content | 24 authored AAA-style demonstrations with camera tracks and timed physics beats |
| Rendering | HDR target, 4× MSAA, 2K PCF shadows, PBR-inspired lighting, sky/fog, bloom/tone map/vignette/grain |
| Effects | Sparks, smoke, dust, shockwaves, muzzle flashes, rain flashes, camera shake |
| Diagnostics | Body/FX/FPS/simulation/render/upload/backend/hash telemetry, grid/axes/bounds |
| Verification | Strict TypeScript, nine deterministic suites, repository contract checks, production build, live browser test runner |
| Delivery | GitHub CI, Pages workflow, environment doctor, safe existing-repo replacement script |

## Honest boundary

This repository is a detailed AAA-style engineering showcase—not a claim of a finished commercial engine. Box3D owns physics; WebGPU owns rendering. The preview backend exists to verify the app before native artifacts are compiled. Full native one-to-one parity for every generated variant, skeletal characters, texture authoring, audio, and production asset streaming remain roadmap work.

## Primary commands

```bash
npm install
npm run doctor
npm run validate
npm run dev
```

Native Box3D browser backend:

```bash
npm run fetch:box3d
npm run build:wasm
npm run dev
```

Publish into the existing profile repository:

```bash
bash scripts/push-existing-box3d-webgpu.sh
```
