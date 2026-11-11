# Rendering Pipeline

Version 1.9 semantically ports GPU cloth/rope rendering changes onto the reconstructed v1.8.1 pipeline. It preserves the v1.4.1 presentation correction: the final fullscreen pass flips the resolved HDR texture's V coordinate exactly once. The camera rig, view/projection matrices, shadow convention, and world-space simulation are unchanged. The complete manifest-sealed integration gate passed on July 14, 2026; see [`INTEGRATION_V1.9.md`](INTEGRATION_V1.9.md).

## Frame graph

```text
Rigid simulation              Soft simulation
Box3D WASM / preview           SIMD WASM / scalar WASM / JavaScript
       │                              │
       │                    ┌─────────┴──────────┐
       │                    │                    │
model/color instances   intact cloth        shallow water
                        current + rest       eta + u + v
                             │                    │
                             └──── storage buffers ────┐
                                                       │
tearing cloth ── 24-byte packed vertices ──────────────┤
rope nodes + segments ── WebGPU compute expansion ─────┤
payload/effects ── cached instance streams ────────────┤
                                                       ↓
Pass 0: compact rope render expansion
  node positions + topology-versioned segment metadata
  compute-generated model matrices + material colors
                                                       ↓
Pass 1: directional shadow depth (2048² depth32float)
  instanced rigid/rope/effect geometry (boxes, spheres, capsules)
  intact GPU-cloth shadow reconstruction
  packed tearing-cloth shadow fallback
                                                       ↓
Pass 2: HDR scene (rgba16float, 4× MSAA)
  atmosphere and sky
  instanced PBR solids (boxes, spheres, capsules)
  intact GPU cloth or packed tearing cloth
  GPU-reconstructed translucent water
  debug/effect lines
  resolve to single-sample HDR texture
                                                       ↓
Pass 3: final presentation
  neighborhood glow · exposure · ACES-inspired tone map
  vignette · grain · display gamma · one V flip
```

## Geometry and state layouts

### Instanced geometry

Rigid bodies, compute-expanded rope segments, payloads, projectiles, droplets, floaters, and solid effects use:

```text
model matrix   16 × float32
color/tag       4 × float32
```

The renderer's `uploadSoftInstances` cache keys the soft stream by array identity, offsets/counts, and `frameVersion`. Re-requesting an unchanged frame performs no additional soft-instance queue write.

### Sphere and capsule instances

Added 2026-11-11. The engine creates spheres and capsules as well as boxes, and every shape uses the same instance row. A sphere row is scaled `(r, r, r)`. A capsule row is scaled `(radius, halfLength, radius)` with its axis along local Y.

The shape of each row reaches the renderer through two optional methods on `InstanceBufferSource` (`src/types.ts`):

```text
shapeVersion()   changes when a body is created or destroyed, or the scene is replaced
shapeKinds()     one byte per row: 0 box, 1 sphere, 2 capsule; null when every row is a box
```

A source without them has only boxes. That is the JavaScript fallback backend and every recipe scene. `NativeWorldBackend` returns the bridge's colour version as the shape version, because the bridge raises it on exactly those events, and reads the kinds from the bridge once per version. `uploadInstances` compares the version only on a frame whose transforms or colours changed.

`src/webgpu/instance-shapes.ts` turns the kinds into a plan: runs of consecutive rows per shape. A stream with no sphere or capsule has no plan, and its frames take the original single `draw(36, instanceCount)`. With a plan, each pass that draws rigid instances directly uses the same pipeline and the same instance streams, and changes only the mesh in vertex slot 0:

| Rows | Mesh | Instance streams | Draw |
|---|---|---|---|
| box | cube, 36 vertices | row matrices and colours | one draw per run of box rows; rows after the rigid stream (rope, soft, effects) join the last run |
| sphere | unit sphere, 32 × 16, 2,880 vertices | row matrices and colours | one draw per run of sphere rows |
| capsule wall | open unit cylinder, 32 segments, 192 vertices | row matrices and colours | one draw per run of capsule rows |
| capsule ends | upper hemisphere: the first 1,440 sphere vertices | cap matrices and colours, two per capsule | one draw |

The capsule is exact at any radius and length, not a stretched sphere. The row matrix scales the cylinder to radius and half length. The two ends are hemispheres of the radius, centred at ± the row's Y column: the `+Y` cap has columns `(X, Ŷ·r, Z)` and the `−Y` cap `(X, −Ŷ·r, −Z)`, which is the hemisphere turned half a revolution about X, so its winding is kept and back-face culling works. This is the decomposition `syncShapeMeshes` uses in `packages/box3d-kit/src/three.ts`. The cap rim and the cylinder rim use the same sine and cosine values. Cap matrices are derived on the CPU (80 bytes per cap) when the rigid stream changes; the round meshes and the cap buffers are created the first time a plan exists.

Passes and optional paths:

| Path | Spheres and capsules |
|---|---|
| Shadow pass, direct | drawn; they cast shadows |
| HDR opaque pass, direct | drawn with the PBR solid shader; normals come from the mesh |
| HDR transparent pass, direct | drawn; glass and dust tags work on any shape |
| Material partition (`instancePartitioning`, opt-in) | falls back. Its lists treat every instance as a cube, so a frame with a plan is drawn directly. A renderer created with partitioning compiles its solid pipelines for vertex pulling only, so it compiles two direct pipelines per sample count the first time it needs them. The partition resumes when every row is a box. |
| GPU visibility lists (`computeVisibility`, opt-in) | falls back the same way: no visibility list is encoded for a frame with a plan. Round shapes are therefore not frustum-culled. |
| GPU rope expansion | unchanged; it writes box rows after the rigid stream |

`instanceShapeInfo()` reports the mode and the sphere and capsule counts.

Box-only cost, measured on Dawn's null backend (CPU-side upload, encoding and submission of the real `WebGPURenderer`, 4,096 boxes, best of the rounds, before → after): a moved frame 69.7 → 66.9 µs; a moved one-body upload 951 → 933 ns; an unchanged upload 19 → 19 ns. The differences are below the run-to-run spread of 10–50% on the shared machine, so no cost was measured. This is not a GPU timing.

### Intact cloth

The solver publishes grid topology plus:

```text
current position.xyz    12 changed-frame bytes per vertex
rest position.xyz       12 immutable bytes per vertex
indices                 uint16, uploaded only when topology changes
```

The immutable rest buffer is uploaded only when its identity or topology version changes, so it is not part of steady changed-frame traffic. The vertex shader derives strain from current/rest geometry and reconstructs neighbor-based normals, UVs, checker parity, two cloth colors, stress heat, woven response, world position, and shadow position. Intact cloth uses dedicated main and shadow pipelines.

### Compact rope

The rope simulation publishes:

```text
node position.xyz       12 changed-frame bytes per node
segment metadata        8 × float32 per active segment
                        nodeA, nodeB, inverseRestLength, radius, RGBA
```

Segment metadata is uploaded only after a topology-version change. A compute shader reads current node positions and segment metadata, derives stable orientation, length, tension, radius response, and material color, then writes the shared instance buffers. The subsequent shadow and HDR passes consume those instances like other solid geometry.

This compute stage does not integrate rope particles or solve constraints. Rope physics remains CPU/JavaScript or CPU/WebAssembly work.

### Tearing cloth fallback

Once topology can change, the grid-neighbor assumption no longer represents disconnected triangles. Tearing cloth therefore keeps the validated packed path:

```text
position        float32x3
normal          octahedral snorm16x2
color/stress    unorm8x4
UV              unorm16x2
stride          24 bytes per vertex
indices         uint16
```

This is an intentional correctness boundary, not a failed GPU path.

### Shallow water

The solver publishes authoritative heightfield state:

```text
eta             4 bytes per cell
u               4 bytes per cell
v               4 bytes per cell
total          12 bytes per cell
indices         uint16, static/upload-once topology
```

The water vertex shader reconstructs X/Z grid position, height, normal, curvature, current-driven foam, UVs, and material inputs. The pipeline keeps alpha blending and disabled depth writes for transparent water.

## Upload caching

Surface caching combines:

- `frameVersion` for simulation-state changes;
- `topologyVersion` and index-buffer identity for index uploads;
- current/rest state `ArrayBuffer` identities and vertex counts;
- rope node-frame and segment-topology identities/counts;
- grid/material configuration keys;
- a separate cached soft-instance stream.

An unchanged cloth or water surface, rope grid, rigid/effect/debug stream, and soft-instance frame should report zero additional uploaded bytes. The v1.11 target tests assert this behavior through the actual renderer class.

## Material pipelines

| Pipeline | Geometry | Key behavior |
|---|---|---|
| PBR solid | instanced cubes, spheres, open cylinders and hemisphere caps | GGX-inspired light, shadowing, emissive tag, fog |
| Packed cloth | packed indexed surface | topology-aware tear fallback, two-sided light, stress heat |
| GPU cloth | storage state + indexed grid | normal/UV/color/stress reconstruction, woven shading, shadows |
| GPU cloth shadow | storage state + indexed grid | position reconstruction into light space |
| GPU rope compute | node + segment storage | expand compact rope state into model/material instance buffers |
| GPU water | three storage fields + indexed grid | geometry/normal/foam reconstruction, Fresnel and specular response |
| Line/effect | line list | additive debug vectors, grid, axes, shockwaves |
| Sky | fullscreen triangle | procedural atmosphere, stars, sun, horizon |
| Post | fullscreen triangle | glow, exposure, tone map, vignette, grain, presentation flip |

## Scene uniform block

The 192-byte uniform block contains:

| Range | Data |
|---|---|
| 0–15 | camera view-projection |
| 16–31 | light view-projection |
| 32–35 | camera position + elapsed time |
| 36–39 | light direction + exposure |
| 40–43 | fog color + density |
| 44–47 | viewport + bloom + shadow contribution |

## Quality profiles

| Profile | Internal resolution | Shadows | Effect budget | Intended use |
|---|---:|---:|---:|---|
| Performance | 70% | skipped | 256 | low-power/mobile diagnostics |
| Balanced | 85% | reduced | 512 | general interaction |
| Cinematic | 100% | full | 1,024 | default demonstration |
| Ultra | 115% | full | 1,536 | high-end capture |

Internal resolution is multiplied by device pixel ratio and capped to protect allocations.

## WGSL and resource protections

- `GPUShaderModule.getCompilationInfo()` promotes readable startup failures.
- Shadow PCF uses `textureSampleCompareLevel`, avoiding derivative-uniformity restrictions.
- Shadow coordinates are clamped and masked without a divergent early return.
- The sky pipeline declares `depth24plus` compatibility for the shared HDR pass.
- The writable shadow map uses an isolated uniform-only bind group.
- Empty rigid draws are skipped.
- Storage-buffer layouts are isolated from packed vertex layouts.
- Index streams are range-checked and odd `uint16` byte counts are padded for queue-write alignment.
- The final post shader must retain `let uv = vec2<f32>(input.uv.x, 1.0 - input.uv.y);` exactly once.

## Validation gate

```bash
npm run test:webgpu
```

The target gate compiles the renderer's 11 live WGSL modules, creates 1×/4× packed/GPU cloth and GPU-water variants plus the GPU rope compute pipeline, validates bind groups and attachments, submits a complete offscreen compute → shadow → HDR → post frame through Dawn, and executes the real `WebGPURenderer` class. It verifies 12 changed-frame bytes per intact-cloth vertex, 12 bytes per water cell, topology-cached rope segment metadata, and zero additional queue writes for unchanged streams. The obsolete packed-water shader and its two quality pipelines are intentionally absent because every water scene uses the GPU-water state path.

The current v1.13 tree passes the cross-platform renderer gate and the separate
Dawn/Metal hardware gate. The final local browser acceptance also loaded the
native Box3D WASM backend, rendered cloth/rope/water, exercised interactions,
and recorded zero console warnings or errors. This validates the tested Mac;
it is not a universal browser/driver or FPS claim.

`scripts/webgpu-renderer-runtime-test.mjs` also uploads a mixed box, sphere and capsule stream, checks the bytes uploaded and that kinds are read once per version, submits shaped frames at both sample counts, and checks that the visibility lists stand aside and resume. Run it with `WEBGPU_INSTANCE_PARTITION=1` to check the partition fallback; no gate sets that variable. The null backend validates commands and draws no pixels. `tests/physics/instance-shapes.test.mjs` checks the plan, the meshes and the capsule decomposition.

## Deliberate boundaries

- Sphere and capsule rows are drawn only by direct draws. The partition and visibility lists fall back for a frame that has them.
- The Mechanisms SI demo (`src/engine/mechanisms-scene.ts`, `lab.html?si=mechanisms&seed=N`, or the last entry of the laboratory catalog) is the Lab scene that has these shapes. It is not one of the 800 recipes.

- WebGPU reconstructs surface presentation and expands compact rope render state; the numerical solvers remain CPU/WebAssembly work rather than WebGPU compute.
- Water is transparent forward rendering without order-independent transparency.
- Only one active cloth or water surface is drawn per scene.
- Tearing cloth stays on the packed CPU fallback because its topology is mutable.
- Bloom is a compact neighborhood glow rather than a mip-chain implementation.
- Render telemetry is CPU encode/submit time, not physical-GPU timestamp duration.
