# Box3D WebGPU — AAA Physics Lab

A browser-native 3D physics showcase that keeps **Box3D** as the rigid-body solver and uses **WebGPU** as the real-time presentation layer.

```text
Box3D C17
  fixed-step rigid-body simulation
          ↓ Emscripten / WebAssembly
Stable C ABI + transform/color streams
          ↓ TypeScript backend boundary
WebGPU instancing + shadows + HDR + post processing
          ↓
600 deterministic physics recipes
24 choreographed cinematic hero demonstrations
```

This is an **AAA-style capability demo and engineering lab**, not a claim that a complete commercial game engine has been finished. It focuses on the parts that matter for proving the architecture: physics fidelity, high-volume transform streaming, cinematic readability, reproducible scenes, diagnostics, and a deployment-ready browser build.

---

## What is in this edition

### Physics and simulation

- Build-ready Box3D C17 backend that is compiled to WebAssembly when `npm run build:wasm` is executed.
- Fixed 60 Hz simulation with four solver substeps by default.
- Continuous collision enabled in the native bridge.
- 4,096 native body slots, plus a separate GPU effect-instance budget.
- Deterministic scene seeds and replay hashes.
- Runtime impulse, radial explosion, projectile, and stress-rain actions.
- 600 generated recipes across 12 capability families.
- Authored native and preview-backend set dressing for cinematic catalog modes.
- Deterministic JavaScript preview backend so the UI and renderer can run before WASM is built.

### AAA-style WebGPU presentation

- One instanced cube geometry submission per geometry pass.
- 2,048 × 2,048 directional shadow map with 3 × 3 PCF filtering.
- Front-face shadow culling and slope-aware depth bias.
- `rgba16float` HDR scene target.
- Four-sample MSAA for the main scene and debug/effect lines.
- PBR-inspired GGX direct-light response.
- Sky/ground ambient response and rim illumination.
- Atmospheric sky, horizon haze, procedural stars, and sun glow.
- Distance fog.
- Emissive material tagging through the instance color stream.
- ACES-inspired tone mapping.
- Lightweight neighborhood bloom, vignette, and film grain.
- Additive shockwave/debug lines.
- Deterministic spark, smoke, dust, muzzle-flash, rain-flash, and camera-shake effects.
- Runtime WGSL compilation checks with readable shader errors.

### Demo direction and control

- 24 authored hero sequences with camera keyframes and timed physics beats.
- Automatic slow motion, impact beats, explosions, projectiles, rain, and final telemetry capture.
- Maximum AAA Tour that chains all hero demonstrations.
- Searchable/filterable browser for all 600 scenes.
- Performance, Balanced, Cinematic, and Ultra profiles.
- Quality profiles alter exposure, bloom, fog, shadow contribution, effect budget, and internal resolution.
- Live body, dynamic-body, effect, FPS, simulation, render-submit, upload, backend, quality, and replay-hash telemetry.
- Optional body bounds, world grid, axes, and shockwave diagnostics.

---

## 600-scene capability matrix

The catalog is generated as:

```text
12 families × 5 presentation modes × 10 variants = 600 recipes
```

The five modes move from a clean baseline toward dense, cinematic, and maximum-load arrangements. The 24 hero demos are hand-authored orchestration placed on top of selected maximum-mode scenes.

| Family | Recipes | Primary capability |
|---|---:|---|
| Stack Labs | 50 | stacked contacts, settling, buckling, sleeping |
| Domino Dynamics | 50 | thin bodies, timing, contact-wave propagation |
| Tall Structures | 50 | floors, columns, shells, impacts, progressive collapse |
| Bridges / Infrastructure | 50 | segmented decks, concentrated loads, long-span failure |
| Material Labs | 50 | friction, restitution, density, damping, ramps |
| Rain / Stress | 50 | high-volume spawning, collision density, transform bandwidth |
| Demolition | 50 | walls, fortifications, projectiles, radial disruption |
| Vehicles / Machines | 50 | moving cargo, obstacles, impact lanes, rollover behavior |
| Marble / Toy Physics | 50 | small-body flow, pegs, ramps, timing gates |
| Construction Sites | 50 | framing, scaffolds, modular loads, crane staging |
| Warehouses / Logistics | 50 | racks, pallets, sorting lanes, cascading inventory |
| Architecture | 50 | atriums, colonnades, façades, stadium-like structures |

See [`docs/AAA_SHOWCASE.md`](docs/AAA_SHOWCASE.md) for the complete 24-demo runbook.

---

## Run immediately

From the project root—the directory containing this `package.json`:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite in a WebGPU-capable browser.

The app first attempts to load:

```text
public/box3d/box3d.js
public/box3d/box3d.wasm
```

If those files are not present, it starts with the deterministic preview backend and clearly labels that state in the interface.

### The folder rule that prevents the earlier ENOENT error

Run npm commands here:

```text
box3d-WEBGPU/
├── package.json
├── src/
├── wasm/
└── scripts/
```

Do **not** run npm commands from here:

```text
box3d-WEBGPU/third_party/box3d/
├── CMakeLists.txt
├── include/
├── src/
└── samples/
```

The second directory is the upstream C/CMake dependency and intentionally has no Node `package.json`.

Verify the downloaded source archive before installing dependencies, then check the environment:

```bash
npm run verify:source
npm run doctor
```

---

## Build the real Box3D WASM backend

### 1. Activate Emscripten

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### 2. Fetch the pinned Box3D release

```bash
cd /path/to/box3d-WEBGPU
npm run fetch:box3d
```

The fetch script defaults to `v0.1.0`. Override it when deliberately testing another revision:

```bash
BOX3D_REF=main npm run fetch:box3d
```

### 3. Compile the bridge

```bash
npm run build:wasm
npm run dev
```

The build generates:

```text
public/box3d/box3d.js
public/box3d/box3d.wasm
```

### Why this build wrapper exists

`wasm/CMakeLists.txt` owns the Emscripten project and includes upstream Box3D as a subproject. This avoids inheriting the upstream top-level pthread policy for a browser demo that currently steps with one worker. It also:

- keeps WebAssembly SIMD enabled by default;
- builds Box3D and the bridge with one CMake graph;
- produces an ES-module factory consumed directly by `src/physics/wasm.ts`;
- preserves memory growth while reading the current Emscripten heap view through a getter;
- exports only the bridge API used by the application.

Disable SIMD only as a compatibility diagnostic:

```bash
BOX3D_DISABLE_SIMD=ON npm run build:wasm
```

Use a Box3D checkout elsewhere:

```bash
BOX3D_ROOT=/absolute/path/to/box3d npm run build:wasm
```

---

## Controls

| Input | Action |
|---|---|
| Mouse / pointer drag | Orbit the camera and leave cinematic playback |
| Mouse wheel | Zoom |
| Hero Play | Run selected choreographed sequence |
| Hero Restart | Reset and replay selected hero sequence |
| Hero Next | Advance to the next authored demonstration |
| Maximum AAA Tour / `T` | Chain all hero sequences |
| Search / family / scene selector | Browse all 600 recipes |
| Previous / Next | Step through filtered catalog results |
| Random / `R` | Load a random matching scene |
| Stress | Rebuild scene at scale 1–5 |
| Render profile | Select resolution/effect/lighting budget |
| Time scale | Set 0.25×, 0.5×, 1×, or 2× |
| Space | Broad structural impulse |
| `E` | Radial blast and cinematic effects |
| `F` | Fire camera-relative projectile |
| Rain button | Add stress bodies without resetting |
| `P` | Pause/resume |
| `N` | Advance one fixed simulation frame |
| `D` | Toggle diagnostics |

---

## Test and validate

Run the complete local gate:

```bash
npm run validate
```

It executes:

1. strict TypeScript typecheck;
2. nine Node test suites;
3. creation checks for all 600 recipes;
4. camera/beat validation for all 24 hero sequences;
5. authored set-dressing checks;
6. fixed-step matrix-finiteness checks;
7. deterministic replay-hash comparison;
8. cinematic effect budget and emissive-data checks;
9. bridge/build/UI/render-feature repository self-test;
10. production Vite build.

Inside the running app, **Run 600 + 24 Browser Tests** performs an additional live test against whichever backend is active.

See:

- [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)
- [`VALIDATION_REPORT.md`](VALIDATION_REPORT.md)
- [`CHANGELOG.md`](CHANGELOG.md)
- [`docs/LOCAL_BROWSER_VALIDATION.md`](docs/LOCAL_BROWSER_VALIDATION.md)

---

## Source map

```text
src/main.ts
  fixed-step loop, UI, camera control, cinematic director, actions,
  telemetry, live browser validation

src/scenes.ts
  deterministic 600-recipe catalog and capability metadata

src/showcases.ts
  24 authored sequences, camera tracks, timed beats, objectives

src/effects.ts
  deterministic CPU-authored particles, shockwaves, dust, flashes,
  camera shake, GPU instance generation

src/physics/wasm.ts
  Emscripten module loading and stable PhysicsBackend wrapper

src/physics/fallback.ts
  deterministic browser preview backend and authored set dressing

src/webgpu/renderer.ts
  shadows, HDR, MSAA, PBR-inspired lighting, sky, fog, effect lines,
  post processing, runtime WGSL diagnostics

wasm/box3d_web.c
  C ABI, native scene recipes, Box3D world/body creation,
  transform/color streams, impulses, projectiles, rain, replay hash

wasm/CMakeLists.txt
  single Emscripten build graph with Box3D as a subproject

scripts/fetch-box3d.sh
  reproducible upstream source fetch

scripts/build-wasm.sh
  native browser backend build

scripts/push-existing-box3d-webgpu.sh
  safe clone/test/build/commit/push flow for nathansenn/box3d-WEBGPU
```

---

## GitHub and Pages

Target repository:

```text
https://github.com/nathansenn/box3d-WEBGPU
```

From this package root:

```bash
bash scripts/push-existing-box3d-webgpu.sh
```

The script clones the existing repository, preserves `.git`, replaces the working tree, installs dependencies, runs tests, builds production assets, commits, and performs a normal push to `main`.

Included workflows:

- `.github/workflows/ci.yml` — typecheck, test, build.
- `.github/workflows/pages.yml` — validated GitHub Pages deployment.

Expected Pages location after enabling **Settings → Pages → Source: GitHub Actions**:

```text
https://nathansenn.github.io/box3d-WEBGPU/
```

---

## Current boundaries

The package is intentionally honest about what is and is not complete:

- When the native artifacts are present, physics is computed by Box3D/WASM—not by WebGPU compute. Before that build, the app clearly uses the deterministic preview backend.
- The preview backend is an AABB-oriented deterministic approximation, not a replacement for Box3D.
- All 600 entries are parameterized capability recipes; they are not 600 individually modeled art environments.
- The renderer currently visualizes bodies with scalable cube geometry. Hull-, sphere-, capsule-, mesh-, and height-field-specific render meshes are the next visual-parity milestone.
- The native bridge covers all 12 families and adds AAA set dressing to cinematic modes, but deeper one-to-one recipe parity can continue.
- There is no audio, animation graph, texture asset pipeline, skeletal character system, networking, or editor serialization yet.
- GPU timings shown in the HUD are CPU command-encoding/submission measurements, not timestamp-query GPU duration.

---

## Highest-value next engineering milestones

1. Move native stepping into a Web Worker with a double-buffered transform stream.
2. Add native joints: distance, revolute, prismatic, wheel, weld, and motor showcases.
3. Add Box3D contact/body events, ray/shape casts, sensors, and character mover demos.
4. Render shape-accurate meshes and native debug-draw data.
5. Add WebGPU timestamp queries and per-pass GPU profiling.
6. Replace the lightweight glow approximation with a mip-chain/separable bloom pipeline.
7. Add contact heatmaps, normals, impulses, broadphase bounds, islands, sleeping, and CCD overlays.
8. Add recording/replay import/export through Box3D’s native recording API.
9. Add a scene JSON schema, editor, and golden-image regression captures.
10. Explore WebGPU compute only for well-isolated workloads such as particle simulation, AABB generation, and broadphase experiments.
