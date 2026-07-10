# WebGPU Port Roadmap — From AAA Showcase to Production Runtime

## Delivered baseline

```text
Box3D C17
  → stable C ABI
  → Emscripten ES-module/WASM
  → refreshed heap views
  → fixed-step TypeScript coordinator
  → WebGPU instanced renderer
  → cinematic director / diagnostics / validation
```

The current edition already supplies 600 deterministic recipes, 24 hand-authored hero sequences, HDR/MSAA/shadows/post processing, effects, native build tooling, and a preview backend. The remaining roadmap is about fidelity, scale, production assets, and runtime architecture—not filling an empty shell.

## Phase 1 — Native parity and solver observability

- Implement one-to-one native recipe generation for all 600 catalog variants.
- Add spheres, capsules, convex hulls, meshes, and height fields to the visual stream.
- Expose joints, motors, limits, sensors, contact events, overlap queries, ray casts, and shape casts.
- Stream contact points, normals, impulses, AABBs, islands, and sleep state into dedicated debug buffers.
- Add deterministic recording/replay files with backend version and seed metadata.
- Add numerical regression baselines for key scenes.

Acceptance gate:

```text
all 600 browser tests pass on Box3D WASM
hero replay hashes are stable for a pinned Box3D revision
no stale heap views after memory growth
no preview-only geometry in native hero demos
```

## Phase 2 — Worker isolation and frame pacing

- Move native stepping into a dedicated Worker.
- Use double-buffered transferable arrays as the compatibility path.
- Add SharedArrayBuffer ring buffers under COOP/COEP deployment headers.
- Interpolate render transforms between fixed physics snapshots.
- Add frame-budget control, catch-up limits, and overload reporting.
- Separate simulation CPU timing from render encoding and GPU timestamp data.

Acceptance gate:

```text
render loop remains responsive during maximum stress
physics never runs with an unbounded accumulator
worker disconnect/restart is recoverable
input-to-simulation latency is measured and displayed
```

## Phase 3 — Production geometry and materials

- Replace cube-only rendering with cached primitive and imported-mesh geometry pools.
- Add bindless-style material indexing within WebGPU limits.
- Add physically based texture sets: base color, normal, roughness, metalness, AO, emissive.
- Add KTX2/Basis texture transcoding and mip generation.
- Add GPU frustum/occlusion culling and indirect draw compaction.
- Add LOD policy and meshlet experiments for large architectural scenes.

Acceptance gate:

```text
visual shape matches collision shape
materials remain deterministic by scene seed
asset budgets and fallbacks are documented
maximum demo has no per-body draw-call scaling
```

## Phase 4 — Lighting and post-production

- Cascaded directional shadows with stabilized splits.
- Image-based lighting and prefiltered environment maps.
- GTAO/SSAO or equivalent ambient occlusion.
- Velocity buffer and temporal anti-aliasing.
- Separable/mip-chain bloom and exposure adaptation.
- Screen-space/contact shadows where valuable.
- GPU particles, trails, debris impostors, and volumetric dust.
- Color-grade LUTs and capture-safe cinematic profiles.

Acceptance gate:

```text
quality tiers have explicit GPU budgets
no temporal artifacts during camera cuts
post effects degrade gracefully on integrated GPUs
shader compilation and pipeline creation remain validated
```

## Phase 5 — Interaction and gameplay systems

- Object picking and transform gizmos.
- Runtime collider authoring and validation.
- Character mover demo and moving-platform tests.
- Vehicle constraints and machinery controls.
- Destruction authoring tools and weak-point metadata.
- Scenario scripting through data, not hard-coded UI branches.
- Save/load/share scene configurations.

## Phase 6 — Platform hardening

- Browser/GPU compatibility matrix and automated screenshot tests.
- Device-loss recovery and adapter fallback strategy.
- Memory and resource lifetime audits.
- WebGPU error scopes around allocations and pipeline creation.
- Content Security Policy and cross-origin isolation deployment presets.
- Accessibility, touch controls, reduced-motion mode, and keyboard navigation.
- Progressive loading and offline/PWA packaging.

## Non-goal clarification

A full GPU rigid-body solver is not required to call this a WebGPU physics application. The deliberately chosen production pattern is CPU/WASM rigid-body authority plus GPU rendering/effects. GPU compute experiments should be added where they provide measurable value—particles, culling, broadphase visualization, deformables, or specialized solvers—without replacing a verified rigid-body engine merely for novelty.
