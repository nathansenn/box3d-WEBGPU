# Box3D WebGPU Maximum Lab

A browser-native physics showcase built around this architecture:

```text
Box3D C17 physics engine
        ↓ Emscripten / WebAssembly bridge
TypeScript physics backend wrapper
        ↓ transform + color buffers
WebGPU instanced renderer
        ↓
600-scene browser physics capability lab
```

The package also includes a deterministic JavaScript fallback physics backend. The app can run immediately while you set up Emscripten and build the real Box3D WASM bridge.

---

## Important folder rule

Run `npm` commands from this project root — the folder that contains this `package.json`.

Do **not** run `npm run build:wasm` from inside `third_party/box3d`. The upstream Box3D folder is a C/CMake source repository and does not have its own `package.json`.

Check your setup with:

```bash
npm run doctor
```

If your terminal prompt says something like `box3d %`, you are probably inside the upstream dependency folder. Go back to the WebGPU lab folder first.

```bash
cd /path/to/box3d-WEBGPU
```


## Publish to GitHub

This repo is prepared for `nathansenn/box3d-WEBGPU`. From the project root, after signing in with GitHub CLI:

```bash
bash scripts/publish-github.sh
```

That script initializes Git if needed, creates the GitHub repository if it does not already exist, pushes `main`, and sets the repository homepage to the GitHub Pages URL. The included GitHub Actions workflows run CI and deploy the WebGPU demo from `dist/`.

---

## What this adds beyond the Epic Lab

- **600 procedural demo scenes** across 12 families.
- Searchable scene browser with category filtering.
- Featured scene buttons for the strongest demo moments.
- **Max Tour mode** that cycles through showcase scenes and triggers automatic projectiles, rain, explosions, and impulse events.
- WebGPU instanced cube renderer.
- WebGPU debug line overlay.
- Orbit camera and keyboard controls.
- Stress slider for scene complexity.
- Runtime stats: bodies, dynamic bodies, FPS, sim-frame time, GPU upload MB, backend, replay hash.
- Browser smoke tests across the full 600-scene catalog.
- Node/TypeScript unit tests for catalog coverage, fallback physics, determinism, and actions.
- Repository self-test that verifies the bridge API and build script exports stay aligned.
- Expanded C bridge mapping all 12 scene families into Box3D-native recipe groups.

---

## Scene families

| Family | Count | Purpose |
|---|---:|---|
| Stack Labs | 50 | stacked contacts, buckling, sleeping, settling |
| Domino Dynamics | 50 | thin-body chains, contact propagation, cascading impulses |
| Tall Structures | 50 | procedural towers, braces, skybridges, projectiles |
| Bridges / Infrastructure | 50 | segmented decks, load piles, truss proxies |
| Material Labs | 50 | friction, restitution, density, ramp lanes |
| Rain / Stress | 50 | high-volume spawn and GPU matrix uploads |
| Demolition | 50 | walls, castles, blasts, projectile breaches |
| Vehicles / Machines | 50 | moving cargo, barriers, obstacle courses |
| Marble / Toy Physics | 50 | small body flow, pegs, ramps, timing gates |
| Construction Sites | 50 | modular assemblies, framing, scaffold, dropped loads |
| Warehouses / Logistics | 50 | racks, pallets, sorters, inventory chaos |
| Architecture | 50 | colonnades, atriums, stadiums, facades, mega structures |

---

## Run the demo immediately

```bash
npm install
npm run dev
```

Open the printed local URL in a WebGPU-capable browser. Chrome, Edge, and other Chromium-based browsers currently provide the smoothest WebGPU path.

The app tries to load `box3d/box3d.js` from the deployed base path. If it is not there yet, it runs the JS fallback backend and displays a warning in the HUD.

---

## Build the real Box3D WASM backend

Install and activate Emscripten first:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

Then from this package:

```bash
git clone https://github.com/erincatto/box3d.git third_party/box3d
npm run build:wasm
npm run dev
```

Generated files:

```text
public/box3d/box3d.js
public/box3d/box3d.wasm
```

---

## Controls

| Input | Action |
|---|---|
| Drag | Orbit camera |
| Mouse wheel | Zoom |
| Search/select/category | Browse all 600 scenes |
| Prev / Next | Move through the catalog |
| Random or `R` | Load a random example |
| Max Tour or `T` | Auto-cycle featured scenes |
| 1–9 | Load first nine scenes |
| Space | Kick / impulse |
| E | Explosion |
| F | Fire projectile |
| P | Pause / resume |
| N | Step one fixed frame |
| D | Toggle debug overlay |

---

## Test it

```bash
npm test
```

This runs:

1. TypeScript typecheck.
2. Unit tests for math, 600-scene catalog integrity, fallback physics creation, featured scene stepping, determinism, and actions.
3. Repository self-test for bridge/API alignment.

You can also click **Run Browser Tests** inside the app. That loads every scene, simulates it briefly, checks matrix buffers, and reports family-level pass counts and hashes in the HUD.

---

## Architecture

```text
src/scenes.ts
  600-scene catalog generated from 12 capability families

src/main.ts
  App loop, UI, search/filter/select, max tour, camera, metrics, browser smoke tests

src/physics/wasm.ts
  Loads Box3D WASM and wraps b3w_* exports

src/physics/fallback.ts
  Deterministic JS fallback physics backend with matching 12-family scene recipes

src/webgpu/renderer.ts
  WebGPU device/context, solid instanced cube pipeline, debug line pipeline

wasm/box3d_web.c
  C ABI bridge into upstream Box3D with 12-family scene mapping

scripts/build-wasm.sh
  Emscripten/CMake build pipeline

tests/unit.test.ts
  Node-side catalog, unit, fallback, and determinism tests
```

---

## Honest status

- The WebGPU renderer, fallback backend, 600-scene catalog, test harness, UI, and source checks are ready.
- The real Box3D WASM bridge must be built locally with Emscripten and the upstream Box3D source.
- The fallback physics is intentionally not a replacement for Box3D. It exists so the renderer, scenes, UI, stress tests, and diagnostics can run instantly before the WASM build exists.
- The C bridge maps all 12 catalog families but still exposes a demo-facing subset, not every possible Box3D feature.

---

## Best next upgrades

1. Move Box3D WASM stepping into a Web Worker.
2. Add full native Box3D recipe parity for every one of the 600 scene variants.
3. Add persistent GPU debug draw for contacts, normals, hulls, bounds, broadphase, and sleep state.
4. Add replay file export/import.
5. Add GPU compute experiments for AABB generation and broadphase pair candidates.
6. Add mesh-collider visual parity instead of rendering every body as a cube.
