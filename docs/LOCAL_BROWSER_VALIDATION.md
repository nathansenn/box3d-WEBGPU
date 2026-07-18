# Local Browser Validation Runbook

This runbook covers the final checks that static/Dawn tests cannot prove: a visible hardware-backed WebGPU frame, browser/driver behavior, target-device performance, and the complete live catalog gate.

## Prerequisites

- Current WebGPU-capable browser.
- Compatible GPU and driver.
- Node.js and npm.
- For native rigid physics: activated Emscripten SDK and fetched Box3D source.

## 1. Validate the source package

From the project root:

```bash
npm install
npm run verify:source
npm run validate:v1.13
npm run doctor
```

Expected:

- 22 deterministic Node suites pass;
- 750 scene constructors and 30 hero definitions pass;
- strict C17 bridge syntax passes;
- deterministic SIMD/scalar soft-kernel builds and integration pass;
- 11 live WGSL modules and the actual renderer/cache path pass Dawn;
- 150-scene soft/fluid soak passes;
- production build completes;
- `doctor` reports whether native WASM artifacts are present.

## 2. Start the application

```bash
npm run dev
```

Open the exact localhost URL printed by Vite. Do not open `index.html` as `file://`.

The final v1.13 acceptance session used the locally served build in the Codex in-app Browser. **Box3D WASM** loaded, cloth/rope/water rendered and accepted interactions, and the console recorded **0 warnings and 0 errors**. The steps below remain the reproducible checklist for another browser/device.

## 3. Confirm startup

Verify:

1. command deck and 3D canvas are visible;
2. backend badge says **Box3D WASM** or **Deterministic Preview**;
3. the startup banner identifies SIMD soft kernels, scalar soft kernels, or JavaScript soft fallback;
4. FPS, rigid count, and soft telemetry update;
5. pointer orbit and wheel zoom work;
6. browser console has no WGSL/device error;
7. cloth/water surfaces do not flicker or disappear during motion.
8. console warning and error counts remain zero after switching through cloth, rope, and water.

## 4. Exercise quality profiles

Run one rigid hero and one water hero in Performance, Balanced, Cinematic, and Ultra. Confirm internal resolution, shadows, effect budget, fog, bloom, and exposure change without breaking simulation or surface rendering.

## 5. Validate cloth

Run:

- **Tempest Standard Protocol**
- **Parachute Canopy Failure**
- **Progressive Fabric Tear Lab** at stress 5

Confirm:

- pinned points stay fixed;
- folds and wind response are continuous;
- normals remain finite and lighting remains two-sided;
- projectile/explosion actions affect the fabric;
- controlled tears create real openings rather than only color changes;
- intact cloth uses the GPU path while the tearing lab stays on the packed topology path;
- `soft-nodes`, constraints, breaks, energy, and hash update.

## 6. Validate rope

Run:

- **Sky Crane Cable Failure**
- **Suspension Cable Resonance**
- **Multi-Sling Rigging Test** at stress 5

Confirm:

- anchors remain fixed;
- payload motion follows the line;
- tension heat appears before high-stress failure;
- projectile/explosion actions can sever designated links;
- no segment matrices become non-finite;
- residual oscillation settles without numerical explosion.

## 7. Validate water

Run:

- **Tsunami Research Array**
- **Leviathan Impact Basin**
- **Vortex Current Chamber**
- **Rain Impact Reservoir**

Confirm:

- wave propagation and boundary reflection are visible;
- water remains transparent and depth ordering is acceptable;
- normals/specular/foam respond to the field;
- droplets inject ripples;
- floaters follow height/current proxies;
- diagnostic current vectors align with visible flow;
- field height remains bounded during long runs.
- pausing an unchanged water scene drops dynamic surface upload telemetry to zero.

## 8. Run the 30-hero tour

Press `T` or select **Maximum AAA Tour**. Confirm all 30 sequences advance, camera tracks and action beats execute, slow motion enters/exits, progress updates, and manual pointer input returns camera control.

## 9. Run the live 780-scenario gate

Click **Run 750 + 30 State Tests**.

This creates and steps every generated scene, validates rigid and soft state/surface contracts, samples all hero cameras, checks beat order, advances effects, and restores the prior scene. It is a state/catalog check rather than 750 renderer submissions; complete the visual cloth, rope, water, shadow, resize, and cache checks in the preceding sections. Use Performance or Balanced for the first pass.

## 10. Build and verify Box3D WASM

```bash
source ~/emsdk/emsdk_env.sh
npm run fetch:box3d
npm run build:wasm
npm run dev
```

Reload and confirm **Box3D WASM**. Repeat at least one rigid hero, one cloth hero, one rope hero, one water hero, and the live 780-scenario gate.

Generated artifacts:

```text
public/box3d/box3d.js
public/box3d/box3d.wasm
```

## 11. Production/Pages check

```bash
npm run build:pages
npm run preview
```

Repeat one scene from each of the four domains—rigid, cloth, rope, water—and confirm hashed assets and WASM paths resolve under the repository subpath.

Expected v1.13 production output:

```text
HTML                         24.89 kB
main JavaScript             239.27 kB · 66.26 kB gzip
lazy TurboQuant chunk         9.25 kB ·  3.18 kB gzip
moderate-or-higher audit      0 vulnerabilities
```

## Acceptance checklist

- [ ] WebGPU adapter/device created with no uncaptured error.
- [ ] No WGSL compilation or pipeline compatibility failure.
- [ ] Shadow, HDR, MSAA, cloth, water, effects, and post-processing render.
- [ ] All four quality profiles function.
- [ ] All 30 hero sequences complete.
- [ ] All 750 generated scenes load and step.
- [ ] Cloth tears remain topologically valid.
- [ ] Intact cloth and water render through storage-buffer reconstruction.
- [ ] Paused unchanged soft frames stop reporting repeated dynamic uploads.
- [ ] Rope breakage and payload motion remain finite.
- [ ] Water remains bounded and visually stable.
- [ ] Replay hashes match for identical seed/backend/action schedules.
- [ ] Preview backend is clearly labeled without WASM.
- [ ] Box3D WASM is selected after native artifacts are built.
- [ ] Production/Pages bundle loads through `npm run preview`.
- [ ] Browser console remains at 0 warnings and 0 errors after rigid, cloth, rope, and water interaction.
