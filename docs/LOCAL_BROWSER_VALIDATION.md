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
npm run validate:v1.20
npm run doctor
```

Expected:

- 31 deterministic Node suites pass;
- the exact 100-improvement registry passes with ten finite, positive-scale authored entries per signature scene;
- 800 stable scene constructors, 65 hero definitions, 31 material-program contracts, and ten signature-scene contracts pass;
- strict C17 bridge syntax passes;
- deterministic SIMD/scalar soft-kernel builds and integration pass;
- 11 live WGSL modules and the actual renderer/cache path pass Dawn;
- 200-scene soft/fluid/material soak passes;
- production build completes;
- `doctor` reports whether native WASM artifacts are present.

## 2. Start the application

```bash
npm run dev
```

Open the exact localhost URL printed by Vite. Do not open `index.html` as `file://`.

The retained v1.13 acceptance session used the locally served build in the Codex in-app Browser. **Box3D WASM** loaded, cloth/rope/water rendered and accepted interactions, and the console recorded **0 warnings and 0 errors**. The current tree adds the exact-100 signature-stage checks, 31 material programs, 65 total hero sequences, and the combined materials proving ground described below. That retained session is historical evidence only: **no new visible-browser capture is claimed for the expanded material layer**, so do not mark these additions passed until this runbook has been completed on the target browser/device.

## 3. Confirm startup

Verify:

1. command deck and 3D canvas are visible;
2. backend badge says **Box3D WASM** or **Deterministic Preview**;
3. the startup banner identifies SIMD soft kernels, scalar soft kernels, or JavaScript soft fallback;
4. FPS, rigid count, and soft telemetry update;
5. pointer orbit and wheel zoom work;
6. browser console has no WGSL/device error;
7. cloth/water surfaces do not flicker or disappear during motion.
8. console warning and error counts remain zero after switching through cloth, rope, water, and material failure.

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

## 8. Validate material bending and fracture

Run:

- **Titan Metal Bend & Dent**
- **Concrete Spall & Rebar Exposure**
- **Glass Catastrophic Fracture**
- **Apex Materials Proving Ground**
- one cyclic-overload material scene at stress 5

Confirm:

- the Material Load Rig appears only for Material Failure scenes;
- the 0–200% load slider, Apply (`L`), Release (`U`), and Cycle controls affect the active specimen;
- supports remain fixed and all node/member values remain finite;
- steel-like presets yield, retain visible plastic set after release, and then rupture under higher load;
- glass-like presets remain comparatively stiff and fail with little plastic deformation;
- cyclic loading accumulates deterministic fatigue damage;
- projectiles, explosions, and rain can add localized damage without exceeding bounded particle/member capacities;
- heat/emissive response rises with member demand/damage;
- yielded, damaged, broken, peak-damage, strain, threshold, energy, and failure-phase telemetry update consistently;
- reset plus the same seed/action schedule reproduces the same fracture topology and replay hash;
- compact material members render in both the shadow and main passes with zero uncaptured WebGPU errors.
- the combined proving ground keeps its metal, glass, and concrete bays spatially separated while targeted load, strike, and release beats affect only the selected bay;
- the combined frame remains at or below the 3,072 soft CPU-proxy capacity through the heaviest beat.

Treat all thresholds as normalized comparison values. Do not report them as real stress, strength, fatigue life, FEA, or safety calculations.

Then traverse the complete authored material registry and confirm all **31 programs** load: 10 metal bending/denting programs, 10 glass impact/fracture programs, 10 concrete load/fracture programs, and the one combined AAA proving ground. Confirm the fixture, boundary condition, load pattern, strike location, camera, label, and failure presentation change with the selected recipe rather than replaying one cosmetically renamed specimen.

## 9. Inspect the ten signature stages and run the 65-hero tour

Before starting the tour, open every starred signature scene and compare it with the numbered ledger in `AAA_100_IMPROVEMENTS.md`. Confirm all ten improvements for that scene are visible, materially distinct, correctly placed, and retained during the heaviest effect beat. Ordinary scenes must not inherit signature props.

Press `T` or select **Maximum AAA Tour**. Confirm all 65 sequences advance: the retained 34 core heroes plus all 31 material-program heroes. Camera tracks and action beats must execute, slow motion must enter/exit, progress must update, pausing must freeze both physics and director time, and manual pointer input must return camera control. In **Titan Metal Bend & Dent**, confirm the panel bends under the press, springs back after unload, and retains a smaller residual dent after both strike events. In **Apex Materials Proving Ground**, confirm the director moves coherently among all three bays and that metal load/dent, glass strike, and concrete load/fracture beats are visibly distinct.

## 10. Run the live 865-definition gate

Click **Run 800 + 65 State Tests**.

This creates and steps every generated scene, validates rigid, soft, fluid, material, and AAA-stage state/presentation contracts, constructs all 31 derived material programs, samples all 65 hero cameras, checks beat order and combined-bay targeting, advances effects, and restores the prior scene—including its signature props. It requires the full improvement primitive set for each of the ten signature IDs and zero signature primitives for ordinary scenes. The total is **800 stable scenes + 65 hero sequences = 865 definitions**; the 31 material programs are represented by 31 of those hero definitions and do not consume new native scene IDs. This is a state/catalog check rather than 800 renderer submissions; complete the visual cloth, rope, water, material, shadow, resize, and cache checks in the preceding sections. Use Performance or Balanced for the first pass.

## 11. Build and verify Box3D WASM

```bash
source ~/emsdk/emsdk_env.sh
npm run fetch:box3d
npm run build:wasm
npm run dev
```

Reload and confirm **Box3D WASM**. Repeat at least one rigid hero, one cloth hero, one rope hero, one water hero, one material hero, the combined proving ground, and the live 865-definition gate.

Generated artifacts:

```text
public/box3d/box3d.js
public/box3d/box3d.wasm
```

## 12. Production/Pages check

```bash
npm run build:pages
npm run preview
```

Repeat one scene from each of the five domains—rigid, cloth, rope, water, and material failure—and confirm hashed assets and WASM paths resolve under the repository subpath.

Record the actual v1.19 production output from the build. Do not reuse retained historical sizes as if the 100-item stage pass were free:

```text
HTML                         <record build output>
main JavaScript              <record build output and gzip>
lazy TurboQuant chunk        <record build output and gzip>
moderate-or-higher audit      0 vulnerabilities
```

## Acceptance checklist

- [ ] WebGPU adapter/device created with no uncaptured error.
- [ ] No WGSL compilation or pipeline compatibility failure.
- [ ] Shadow, HDR, MSAA, cloth, water, material members, effects, and post-processing render.
- [ ] All four quality profiles function.
- [ ] All 65 hero sequences complete.
- [ ] All 800 generated scenes load and step.
- [ ] All 31 material programs load: 10 metal, 10 glass, 10 concrete, and one combined proving ground.
- [ ] The combined proving ground stays within the 3,072 soft CPU-proxy capacity and targeted actions remain isolated to the intended bay.
- [ ] All 100 numbered improvements are visibly present ten-per-signature scene, and ordinary scenes receive none.
- [ ] Pausing a hero freezes its timeline, camera, beat execution, and physics together.
- [ ] Cloth tears remain topologically valid.
- [ ] Intact cloth and water render through storage-buffer reconstruction.
- [ ] Paused unchanged soft frames stop reporting repeated dynamic uploads.
- [ ] Rope breakage and payload motion remain finite.
- [ ] Water remains bounded and visually stable.
- [ ] All ten material presets load with ordered normalized thresholds.
- [ ] Material load/release/cycle controls, plastic set, damage heat, breaks, telemetry, and reset determinism pass.
- [ ] Material results are labeled as normalized comparisons, not FEA or safety calculations.
- [ ] Replay hashes match for identical seed/backend/action schedules.
- [ ] Preview backend is clearly labeled without WASM.
- [ ] Box3D WASM is selected after native artifacts are built.
- [ ] Production/Pages bundle loads through `npm run preview`.
- [ ] Browser console remains at 0 warnings and 0 errors after rigid, cloth, rope, water, and material interaction.
