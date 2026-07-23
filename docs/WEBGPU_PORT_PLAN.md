# WebGPU Port Roadmap — From AAA Showcase to Production Runtime

## Delivered baseline

```text
Box3D C17 → stable C ABI → Emscripten ES module/WASM
                    ┐
TypeScript cloth/rope PBD + shallow-water solver + material-failure lattice
                    └→ fixed-step coordinator
                       → instanced + indexed WebGPU streams
                       → HDR/MSAA/shadows/materials/post
                       → cinematic director / diagnostics / validation
```

The current edition supplies **800 deterministic scenes, 65 hero sequences, ten signature AAA stages, 200 stable-catalog soft/fluid/material demonstrations, 31 authored material programs, HDR rendering, native build tooling, deep tests, and a deployable browser shell**. Its live catalog/director check therefore covers **865 definitions (800 scenes + 65 heroes)**. The material-program registry is split into **10 metal, 10 glass, 10 concrete, and one combined AAA proving ground**. It overlays the stable 800-scene/native-ID contract rather than inventing new native scene IDs. The material domain includes ten normalized comparative presets, material-specific and bay-targeted load/release/cycle/strike input, deterministic elastic/plastic/damage/fracture telemetry, distinct fixture/boundary/load recipes, a perimeter-clamped metal panel, persistent reinforced-concrete rebar beneath damage-aware cover, a framed radial-fracture glass pane, and a Poliigon-derived material presentation layer. The combined three-bay program remains bounded by the explicit **3,072 soft CPU-proxy capacity**. The roadmap now concerns calibration, coupling, scale, authoring, and hardening—not an empty prototype.

## Phase 1 — Native parity and solver observability

- Implement one-to-one native rigid staging for all 800 scene recipes.
- Add spheres, capsules, convex hulls, meshes, and height fields to the visual stream.
- Expose joints, motors, limits, sensors, contact events, overlap queries, ray casts, and shape casts.
- Stream contact points, normals, impulses, AABBs, islands, and sleep state.
- Add persistent recording/replay files with backend, seed, and solver revisions.
- Add numerical baselines for representative rigid/cloth/rope/water/material scenes.

Acceptance:

```text
all 800 browser scenes pass on Box3D WASM
all 65 hero sequences retain valid native staging
all 31 material programs retain their 10/10/10/1 registry split and targeted action routing
no stale heap views after memory growth
replay baselines are versioned and reproducible
```

## Phase 2 — Bidirectional rigid/soft coupling

- Query Box3D shapes for cloth and rope collision.
- Apply soft payload, cable, and buoyancy forces back to Box3D bodies.
- Add frictional cloth contact and continuous projectile collision.
- Add rope pulleys, winches, motors, and moving anchors.
- Add shallow-water obstacle/depth maps and shoreline masks.
- Support multiple active cloth/water surfaces.
- Query Box3D contacts for material-specimen impact and return bounded reaction forces.

Acceptance:

```text
cloth drapes over arbitrary rigid colliders
rope anchors can attach to moving Box3D bodies
floaters transfer measurable forces to/from the water field
material specimens exchange measured impact/reaction impulses with rigid bodies
coupling remains stable and deterministic at fixed step
```

## Phase 3 — Worker isolation and frame pacing

- Move native and soft stepping into one or more Workers.
- Use double-buffered transferable arrays as the compatibility path.
- Add SharedArrayBuffer rings under COOP/COEP.
- Interpolate render state between fixed snapshots.
- Add frame-budget control, catch-up limits, and overload reporting.
- Separate simulation CPU, encoding CPU, and GPU timestamp telemetry.

## Phase 4 — GPU-compute deformables and fluids

- Port PBD projection to WebGPU compute behind the existing `SoftSimulationFrame` contract.
- Add graph coloring or Jacobi-style constraint batches.
- Compute cloth normals and strain on GPU.
- Port the shallow-water field update to compute ping-pong textures/buffers.
- Evaluate beam-lattice strain, damage, and constraint projection on WebGPU compute behind the same deterministic reference contract.
- Add GPU particle spray and foam advection.
- Keep deterministic CPU reference solvers for regression comparison.

Acceptance:

```text
compute and CPU reference scenes match bounded error metrics
GPU path scales materially beyond CPU node limits
fallback remains available on constrained devices
no solver migration leaks into UI/director architecture
```

## Phase 5 — Production geometry and materials

- Replace cube-only rigid visuals with primitive/imported-mesh pools.
- Add material indexing and texture sets: base color, normal, roughness, metalness, AO, emissive.
- Add KTX2/Basis transcoding and mip generation.
- Add GPU frustum/occlusion culling and indirect draw compaction.
- Add LOD and meshlet experiments for architectural scenes.
- Add cloth weave/normal maps and physically tuned water environments.
- Separate visual material assets from mechanical presets and support authored fracture-surface/debris geometry.
- Add calibrated constitutive-law plugins only with specimen data, units, convergence tests, and explicit confidence labels.

## Phase 6 — Lighting and post-production

- Cascaded stabilized shadows.
- Image-based lighting and prefiltered environment maps.
- GTAO/SSAO.
- Velocity buffer and temporal anti-aliasing.
- Mip-chain bloom and exposure adaptation.
- Screen-space/contact shadows where valuable.
- GPU volumetric dust, spray, mist, and debris.
- Capture-safe color-grade LUTs.

## Phase 7 — Authoring and gameplay

- Object picking and transform gizmos.
- Runtime collider, cloth-pin, rope-anchor, and water-obstacle authoring.
- Character mover and moving-platform tests.
- Vehicle/machinery controls.
- Destruction weak-point metadata.
- Runtime material preset, support, notch, load-path, and actuator authoring.
- Data-driven scenario scripting.
- Save/load/share scene configurations.

## Phase 8 — Platform hardening

- Browser/GPU compatibility matrix and automated screenshots.
- Device-loss recovery and adapter fallback.
- Memory/resource lifetime audits and scoped WebGPU errors.
- CSP and cross-origin isolation deployment presets.
- Accessibility, touch controls, reduced motion, keyboard navigation.
- Progressive loading, offline/PWA packaging, and telemetry privacy review.

## Non-goal clarification

A WebGPU physics application does not require every solver to run on the GPU. The current architecture intentionally uses verified CPU/WASM authority and WebGPU presentation. Compute migration should happen only where profiling proves value and must preserve tested fallbacks and clear solver ownership.

The delivered material presets are normalized comparative beam-lattice behaviors. They are not calibrated finite-element models, design allowables, fatigue-life predictions, building-code checks, or safety certification. Production engineering use requires measured data, units, geometry/boundary calibration, convergence and uncertainty studies, and independent professional review.
