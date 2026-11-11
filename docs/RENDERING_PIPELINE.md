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
  hull, mesh and height-field bodies from their own geometry
  intact GPU-cloth shadow reconstruction
  packed tearing-cloth shadow fallback
                                                       ↓
Pass 2: HDR scene (rgba16float, 4× MSAA)
  atmosphere and sky
  instanced PBR solids (boxes, spheres, capsules)
  hull, mesh and height-field bodies from their own geometry
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
shapeKinds()     one byte per row: 0 box, 1 sphere, 2 capsule, 3 hull, 4 mesh, 5 height field;
                 null when every row is a box
```

A source without them has only boxes. That is the JavaScript fallback backend and every recipe scene. `NativeWorldBackend` returns the bridge's colour version as the shape version, because the bridge raises it on exactly those events, and reads the kinds from the bridge once per version. `uploadInstances` compares the version only on a frame whose transforms or colours changed.

`src/webgpu/instance-shapes.ts` turns the kinds into a plan: runs of consecutive rows per shape, and the list of rows drawn from a body's own geometry (next section). A stream with no sphere, capsule or own-geometry row has no plan, and its frames take the original single `draw(36, instanceCount)`. With a plan, each pass that draws rigid instances directly uses the same pipeline and the same instance streams, and changes only the mesh in vertex slot 0:

| Rows | Mesh | Instance streams | Draw |
|---|---|---|---|
| box | cube, 36 vertices | row matrices and colours | one draw per run of box rows; rows after the rigid stream (rope, soft, effects) join the last run |
| sphere | unit sphere, 32 × 16, 2,880 vertices | row matrices and colours | one draw per run of sphere rows |
| capsule wall | open unit cylinder, 32 segments, 192 vertices | row matrices and colours | one draw per run of capsule rows |
| capsule ends | upper hemisphere: the first 1,440 sphere vertices | cap matrices and colours, two per capsule | one draw |

The capsule is exact at any radius and length, not a stretched sphere. The row matrix scales the cylinder to radius and half length. The two ends are hemispheres of the radius, centred at ± the row's Y column: the `+Y` cap has columns `(X, Ŷ·r, Z)` and the `−Y` cap `(X, −Ŷ·r, −Z)`, which is the hemisphere turned half a revolution about X, so its winding is kept and back-face culling works. This is the decomposition `syncShapeMeshes` uses in `packages/box3d-kit/src/three.ts`. The cap rim and the cylinder rim use the same sine and cosine values. Cap matrices are derived on the CPU (80 bytes per cap) when the rigid stream changes; the round meshes and the cap buffers are created the first time a plan exists.

Passes and optional paths:

| Path | Spheres, capsules, and bodies with their own geometry |
|---|---|
| Shadow pass, direct | drawn; they cast shadows |
| HDR opaque pass, direct | drawn with the PBR solid shader; normals come from the mesh |
| HDR transparent pass, direct | drawn; glass and dust tags work on any shape |
| Material partition (`instancePartitioning`, opt-in) | falls back. Its lists treat every instance as a cube, so a frame with a plan is drawn directly. A renderer created with partitioning compiles its solid pipelines for vertex pulling only, so it compiles two direct pipelines per sample count the first time it needs them. The partition resumes when every row is a box. |
| GPU visibility lists (`computeVisibility`, opt-in) | falls back the same way: no visibility list is encoded for a frame with a plan. These shapes are therefore not frustum-culled. |
| GPU rope expansion | unchanged; it writes box rows after the rigid stream |

`instanceShapeInfo()` reports the mode and the sphere and capsule counts.

Box-only cost, measured on Dawn's null backend (CPU-side upload, encoding and submission of the real `WebGPURenderer`, 4,096 boxes, best of the rounds, before → after): a moved frame 69.7 → 66.9 µs; a moved one-body upload 951 → 933 ns; an unchanged upload 19 → 19 ns. The differences are below the run-to-run spread of 10–50% on the shared machine, so no cost was measured. This is not a GPU timing.

Measured again for the body-geometry change (same method; ten processes of each build run alternately, best of each, before → after): a moved frame 66.2 → 67.5 µs; a moved one-body upload 924 → 929 ns; an unchanged upload 21.7 → 22.0 ns. Single processes ranged from 66 to 105 µs for the moved frame on either build, so again no cost was measured. A box-only stream reports no shape version; its upload takes one extra local assignment and its frames run the same draw calls as before.

### Hull, mesh and height-field bodies

Added 2026-11-11. A convex hull, a static triangle mesh and a height field have no shared mesh to instance: each is drawn from its own geometry. Their instance rows are unscaled rigid transforms, so the row's matrix and colour are used as they are.

Where the geometry comes from:

```text
NativeWorldBackend.retainBodyShapes(true)   keep a copy of the geometry each such body is created with
NativeWorldBackend.bodyShape(row)           that copy, by render row; the same object for the same body
InstanceBufferSource.shapeGeometry(row)     optional: the render mesh of that row, or null
```

The solver cannot report a shape back, so the world keeps the validated arrays it handed to the bridge. Retention is off by default (the kit's worlds hold no copies); the Lab's backend turns it on for its general world. `src/webgpu/body-geometry.ts` turns a shape into a triangle list in the cube mesh's layout (position.xyz, normal.xyz, 24 bytes a vertex, no index buffer), once per body:

| Kind | Triangles | Normals | Sides |
|---|---|---|---|
| hull | the convex hull of the body's points (`convexHull` in `src/engine/geometry.ts`), wound outward | flat: the triangles of one face share its normal | closed, so back faces are culled as for a box |
| mesh | the body's own triangles; one with no area is dropped | flat, from each triangle's winding | both: every triangle is written a second time reversed, with the opposite normal, because a static mesh is often an open surface and the solid pipeline culls back faces |
| height field | two per cell, split along the diagonal from `(x + 1, z)` to `(x, z + 1)`, which is the split Box3D collides with | smooth: `normalize(-dh/dx, 1, -dh/dz)` from central differences, one-sided at the border | top only, as in the solver |

`tests/physics/body-geometry.test.mjs` checks windings, normals and areas, and compares the height-field triangles with 100 downward ray casts against Box3D on a rough field: they agree within 0.2 mm, where the other diagonal would be off by more than 5 cm.

The renderer keeps one vertex buffer for all such bodies and a vertex range per body. Each row in the plan's `geometryRows` is one `draw(vertexCount, 1, firstVertex, row)` with that buffer in vertex slot 0 and the ordinary row streams in slots 1 and 2, in the same shadow, opaque and transparent pipelines as boxes: the body is lit, shadowed, fogged and textured (triplanar, in metres) like every other solid, and it casts a shadow. A mesh is identified by its object, so the buffer is written when a body with new geometry appears and not when bodies move or change rows. `bodyMeshInfo()` reports the bodies and vertices held.

Limits and fallbacks:

- A row whose source has no geometry for it (no `shapeGeometry`, or it returns null) is drawn as a box, as before. That is the kit's own `PhysicsWorld`, which the Lab renderer does not draw, and any world that did not retain shapes.
- One body's mesh has at most 1,500,000 vertices (36 MB). A mesh above 250,000 triangles is drawn one-sided, and only the first 500,000 triangles of a larger one are drawn; a height field over the budget is drawn from every k-th sample, keeping its last row and column. The scene format allows meshes up to 2,097,152 triangles, so the largest ones are not drawn in full.
- Box3D keeps at most 64 hull vertices. For a hull created with more points than that, the drawn hull is the exact hull of the points and the solver's is an inscribed simplification. Imported geometry goes through `toHullShape`, which stays within the limit, so the two agree there.
- The shadow map covers at least 34 m at 2048², about 3 cm a texel. A part 20 cm across casts a shadow a few texels wide.
- The material partition and the GPU visibility lists fall back to direct draws for a frame with such rows, exactly as for spheres and capsules (table below). These bodies are therefore not frustum-culled.

### Intact cloth

The solver publishes grid topology plus:

```text
current position.xyz    12 changed-frame bytes per vertex
rest position.xyz       12 immutable bytes per vertex
indices                 uint16, uploaded only when topology changes
```

The immutable rest buffer is uploaded only when its identity or topology version changes, so it is not part of steady changed-frame traffic. The vertex shader derives strain from current/rest geometry and reconstructs neighbor-based normals, UVs, checker parity, two cloth colors, stress heat, woven response, world position, and shadow position. Intact cloth uses dedicated main and shadow pipelines.

### Compact rope

The stream is not tied to the rope simulation: any set of nodes and segments in the same layout is drawn. The SI bridge scene ([`SI_BRIDGE.md`](SI_BRIDGE.md)) passes its 16 stays this way, two nodes and one segment each, from the frame node positions of the model.

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

### Scene editor overlay

The Lab's scene editor ([`SCENE_EDITOR.md`](SCENE_EDITOR.md)) adds no pass, pipeline or buffer. A selected body is tinted by writing its row of the rigid instance colour stream in the WASM heap; `WasmPhysicsBackend.markGeneralColorsEdited()` then adds one to the colour version the renderer compares, so the colour stream is uploaded again on that frame and not on the following ones. The shape plan and the body meshes are keyed on the native world's own shape version and are not rebuilt. The selection frame, the joint anchors and axes and the ruler go through the existing line stream in place of the engineering inspection lines, and are restaged when the selection, the document or the simulation tick changes, and on every frame while the simulation plays or a body is dragged. The cost was not measured separately: a selection change uploads 16 bytes per body of the scene once.

## Material pipelines

| Pipeline | Geometry | Key behavior |
|---|---|---|
| PBR solid | instanced cubes, spheres, open cylinders and hemisphere caps; per-body hull, mesh and height-field triangle lists | GGX-inspired light, shadowing, emissive tag, fog |
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

`scripts/webgpu-renderer-runtime-test.mjs` also uploads a mixed box, sphere and capsule stream, checks the bytes uploaded and that kinds are read once per version, submits shaped frames at both sample counts, and checks that the visibility lists stand aside and resume. It does the same for hull, mesh and height-field rows: the body meshes are uploaded once per object (not when bodies move or change rows), a row without geometry stays a box, and frames with body meshes validate at both sample counts. Run it with `WEBGPU_INSTANCE_PARTITION=1` to check the partition fallback; no gate sets that variable. The null backend validates commands and draws no pixels. `tests/physics/instance-shapes.test.mjs` checks the plan, the meshes and the capsule decomposition, and `tests/physics/body-geometry.test.mjs` the body meshes.

Pixels for these bodies were looked at in headless Chromium with software WebGPU (SwiftShader), not on a real GPU: the five example scenes, a dropped OBJ, a dropped STL, a static mesh and a scene with all six shape kinds.

## Deliberate boundaries

- Sphere and capsule rows, and hull, mesh and height-field bodies, are drawn only by direct draws. The partition and visibility lists fall back for a frame that has them.
- The Mechanisms SI demo (`src/engine/mechanisms-scene.ts`, `lab.html?si=mechanisms&seed=N`, in the SI entries at the end of the laboratory catalog) has spheres and capsules. Scene files (`lab.html?example=terrain-car`, `lab.html?scene=…`, or a dropped file; see [`SCENE_FORMAT.md`](SCENE_FORMAT.md)) can have every shape kind. None of them is one of the 800 recipes.
- Body meshes are not level-of-detail reduced or frustum-culled, and they have no index buffer: a flat-shaded triangle list repeats each vertex.

- WebGPU reconstructs surface presentation and expands compact rope render state; the numerical solvers remain CPU/WebAssembly work rather than WebGPU compute.
- Water is transparent forward rendering without order-independent transparency.
- Only one active cloth or water surface is drawn per scene.
- Tearing cloth stays on the packed CPU fallback because its topology is mutable.
- Bloom is a compact neighborhood glow rather than a mip-chain implementation.
- Render telemetry is CPU encode/submit time, not physical-GPU timestamp duration.
