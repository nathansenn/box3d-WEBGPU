# Test Plan — Box3D WebGPU AAA Physics Lab

## Quality gates

```text
source integrity
  → strict TypeScript
  → deterministic Node suites
  → repository contract checks
  → production bundling
  → browser/WebGPU smoke test
  → native Emscripten build (when SDK is available)
```

## Automated local gate

Run:

```bash
npm run validate
```

Expected stages:

1. `tsc --noEmit`
2. test-only CommonJS compilation
3. nine Node suites
4. repository self-test
5. Vite production build

## Node suites

| Suite | Purpose |
|---|---|
| `testMath` | matrix identity/multiplication, finite perspective and orthographic projections |
| `testSceneCatalog` | exactly 600 unique recipes, all categories, valid metadata |
| `testHeroShowcaseCatalog` | exactly 24 unique demos, sorted beats/keys, valid scenes, finite camera sampling |
| `testFallbackCanCreateEveryScene` | every recipe creates bodies, finite transforms, nonzero replay hash |
| `testAAACinematicSetDressing` | cinematic mode adds authored environment bodies; all hero scenes step safely |
| `testFeaturedScenesStep` | featured scenes survive multiple fixed steps with finite transforms |
| `testDeterminism` | identical scene/seed/step sequence produces identical replay hash |
| `testCinematicEffects` | explosion/muzzle/dust/rain particles, shockwave lines, emissive tags, budgets, finite shake |
| `testActions` | impulse, explosion, projectile, rain, body growth, stepping |

## Repository self-test

The self-test checks:

- required source/docs/build/workflow files;
- bridge exports match the build target;
- exactly 24 hero definitions are present;
- all required HTML IDs exist exactly once;
- renderer contains HDR, MSAA, PCF, ACES, WGSL validation, and resolution-profile markers;
- native bridge contains C17 forward declarations and cinematic set dressing;
- CMake uses Box3D as a subproject and exports an ES module;
- package scripts include fetch, native build, validation, and production build.

## Live browser validation

Click **Run 600 + 24 Browser Tests**.

The app:

1. stops cinematic playback;
2. creates and steps all 600 scenes against the active backend;
3. checks body counts, transform finiteness, and replay hash;
4. samples every hero camera at five points;
5. validates beat ordering and minimum beat count;
6. creates and advances an explosion effect frame;
7. restores the previous scene and UI state;
8. prints the pass summary in the validation console.

## Manual rendering matrix

| Area | Checks |
|---|---|
| Startup | WebGPU adapter/device, context configuration, readable failure message |
| WGSL | no compilation errors; warnings reviewed |
| Resize | desktop, narrow tablet, high DPR, browser zoom |
| Shadow | stable PCF, no severe acne/peter-panning, performance mode skips pass |
| HDR/post | no NaNs, no fully clipped highlights, exposure changes visible |
| Effects | effect count honors profile budget; emissive sparks glow; shockwaves align |
| Camera | orbit, zoom, cinematic/manual handoff, shake decay |
| Scene UI | search, family filter, select, previous/next/random, hero shortcuts |
| Director | play, pause, restart, next, slow-motion beat, final telemetry lock, max tour |
| Physics actions | impulse, explosion, projectile, rain on at least four families |
| Diagnostics | grid, axes, bounds, line budget, alignment during motion |
| Backend | preview warning correct; native label correct after WASM build |

## Performance matrix

Measure at stress levels 1, 3, and 5 for:

- Titan Foundry Stackfall;
- Aegis Tower: Kinetic Breach;
- Atlas Suspension Convoy;
- Orbital Cargo Storm;
- High-Bay Cascade;
- Mega Atrium Collapse.

Record:

```text
browser / OS / GPU
backend
quality profile
viewport and DPR
body count
FX count
FPS
physics CPU ms
render-encode/submit CPU ms
upload MB/frame
replay hash
```

Do not call render-submit CPU time “GPU time.” Timestamp-query instrumentation is a future gate.

## Native build gate

With Emscripten active:

```bash
npm run fetch:box3d
npm run build:wasm
npm run dev
```

Verify:

- `public/box3d/box3d.js` exists and is non-empty;
- `public/box3d/box3d.wasm` exists and is non-empty;
- app reports `Box3D WASM`;
- all live browser tests pass;
- projectiles and large stacks use native collision behavior;
- memory growth does not detach the renderer’s heap view.

## Current unexecuted gate in constrained environments

When Emscripten is unavailable, the C bridge and CMake topology can be source-checked but not honestly marked as compiled. The validation report must state this explicitly.
