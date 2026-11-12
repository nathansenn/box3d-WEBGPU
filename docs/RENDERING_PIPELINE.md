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
  hull, mesh, height-field and compound bodies from their own geometry
  intact GPU-cloth shadow reconstruction
  packed tearing-cloth shadow fallback
                                                       ↓
Pass 2: HDR scene (rgba16float, 4× MSAA)
  atmosphere and sky
  instanced PBR solids (boxes, spheres, capsules)
  hull, mesh, height-field and compound bodies from their own geometry
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

### Hull, mesh, height-field and compound bodies

Added 2026-11-11. A convex hull, a static triangle mesh, a height field and a compound of several shapes have no shared mesh to instance: each is drawn from its own geometry. Their instance rows are unscaled rigid transforms, so the row's matrix and colour are used as they are.

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
| compound | every child in the body's frame, turned by its rotation and moved to its position: a box as 12 triangles, a hull as above, a sphere as 24 segments by 12 bands, a capsule as the two halves of that sphere and a 24-sided cylinder between them | flat for boxes and hulls, smooth for spheres and capsules | closed; children may intersect, and nothing is merged |

`tests/physics/body-geometry.test.mjs` checks windings, normals and areas, and compares the height-field triangles with 100 downward ray casts against Box3D on a rough field: they agree within 0.2 mm, where the other diagonal would be off by more than 5 cm. For a compound of a turned box, a sphere, a turned capsule and a turned hull on a turned body it casts a ray at the centre of every drawn triangle (1,116 of them): the box's and the hull's are on the collision surface to 0.1 mm, and the sphere's and the capsule's are below it by the sagitta of the tessellation (under 5 mm at a radius of 0.25 m). A compound has the body's one colour: children are not coloured separately.

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

### Coupled scenes in the Lab

A scene with water, cables, frames, a cloth or grains (`src/lab/coupled-scene.ts`) is drawn without a new pass. `CoupledSceneView` is an `InstanceBufferSource`: a copy of the world's rows followed by its own rows, so the shape plan above covers both. A cloth and a water surface are each one row of kind 4 (own geometry) whose triangle list (`writeTwoSidedMesh`, `writeWaterMesh`) is rebuilt after each simulation step; a new geometry object makes `uploadBodyMeshes` upload it again. Water and grain walls use the translucent material (colour alpha −4), so they are drawn in the transparent part of the main pass. Grains are sphere rows. Cables and frame elements go to the compact rope stream; the water surface's wire grid goes to the overlay line stream. Uploading the meshes every step is the cost: about 24 bytes per vertex, 6 vertices per cloth triangle side (the 81-node trampoline: 128 triangles, 18 kB a step).

A solid is eight more rows of kind 4, one per colour band of the chosen field (stress, temperature or damage): each band's triangle list holds the boundary faces (and, for a fracture body, both sides of every interface) whose element falls in that band, with flat normals, rebuilt after every step. A band with no triangle gets a zero matrix, because a kind-4 row without geometry would be drawn as a unit box. The colour is the row's instance colour; there is no per-vertex colour.

### Scene editor overlay

The Lab's scene editor ([`SCENE_EDITOR.md`](SCENE_EDITOR.md)) adds no pass, pipeline or buffer. A selected body is tinted by writing its row of the rigid instance colour stream in the WASM heap; `WasmPhysicsBackend.markGeneralColorsEdited()` then adds one to the colour version the renderer compares, so the colour stream is uploaded again on that frame and not on the following ones. The shape plan and the body meshes are keyed on the native world's own shape version and are not rebuilt. The selection frame, the joint anchors and axes and the ruler go through the existing line stream in place of the engineering inspection lines, and are restaged when the selection, the document or the simulation tick changes, and on every frame while the simulation plays or a body is dragged. The cost was not measured separately: a selection change uploads 16 bytes per body of the scene once.

## Material pipelines

| Pipeline | Geometry | Key behavior |
|---|---|---|
| PBR solid | instanced cubes, spheres, open cylinders and hemisphere caps; per-body hull, mesh, height-field and compound triangle lists | GGX-inspired light, shadowing, emissive tag, fog |
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

## WebGL2 fallback (Lab)

`lab.html` draws with WebGPU when it can and with a WebGL2 renderer (`src/webgl/lab-renderer.ts`, programs in `src/webgl/lab-shaders.ts`) when it cannot. The Studio's own fallback is separate: it rebuilds its three.js scene on three.js's WebGL backend after a device loss (`src/studio/device-loss.ts`); the Lab's renderer is hand-written, so none of that code draws the Lab. The Lab's WebGL2 renderer reuses the Studio's one idea that applies, retrying a refused context for about two seconds after a loss.

### Selection

`src/webgl/renderer-selection.ts`:

| Address | Tried in order | After a loss |
|---|---|---|
| no `renderer`, `navigator.gpu` present | WebGPU (adapter, device, pipelines), then WebGL2 | WebGPU lost → WebGL2; WebGL2 lost → WebGL2 |
| no `renderer`, no `navigator.gpu` | WebGL2 | WebGL2 |
| `?renderer=webgl2` | WebGL2 | WebGL2 |
| `?renderer=webgpu` | WebGPU only, as before this fallback | WebGPU again |

A lost device or context is replaced without reloading: the renderer is disposed, the canvas element is replaced by a fresh one (a canvas that has held a WebGPU context cannot give a WebGL2 one; its attributes are copied and the pointer handlers bound again), and the new renderer gets every stream again on the next frame. The scene, the simulation clock, the camera and the recorded results are CPU state and are not touched; the frame loop does not step while the replacement is created. The status bar shows the renderer under **Renderer** (its tooltip says why, for example "WebGPU device lost"), the canvas carries `data-renderer`, and `box3dLab.rendererInfo()` returns the kind, the request, the reason, the number of switches and the camera. `box3dLab.simulateGraphicsLoss()` destroys the WebGPU device or loses the WebGL2 context, for tests.

The physics does not depend on the renderer: the modules the fixed step runs import neither renderer (checked by `tests/physics/lab-renderer-selection.test.mjs`), and every example reaches the same state hash after the same number of ticks on both (checked in the browser, below).

### What it draws

The same streams through the same interface (`LabRenderer`): rigid rows with the shape plan of `src/webgpu/instance-shapes.ts` (boxes, spheres, capsules as an open cylinder and two hemisphere caps), hull, mesh, height-field and compound bodies from their own geometry (uploaded once per geometry object), every coupled-scene row (cloth and solid mesh rows, water height fields, grains, translucent grain walls), the rope stream (cables, frame elements, bridge stays), soft instances, effect instances, the packed, GPU-cloth and GPU-water surfaces, and the overlay lines (the scene editor's frame, joints and ruler; the coupled scenes' water grid). The editor's selection tint is the instance colour stream, so it needs nothing of its own. The frame has the same passes: a depth-only shadow map from the directional light (depth32float, slope-scaled bias, 1 or 9 PCF taps as the quality profile says, redrawn only when a caster stream, the light or the map changed), an HDR scene pass (RGBA16F, 4× MSAA at Cinematic and Ultra; sky, opaque instances, the surface, translucent instances, lines), a blit resolve, and a post pass with the same bloom, exposure, ACES curve, vignette and dither.

WebGL2 has no base instance: each run of rows re-points the instance attributes at its first row and draws with `drawArraysInstanced`. The Lab's matrices give WebGPU clip depth (0 to 1); every vertex shader maps it to GL's −1 to 1, so the depth stored and compared is the same number. Shadow and post lookups do not flip V (GL textures start at the bottom row).

### What differs

- No material textures. The Poliigon atlas and the noise texture are KTX2 uploads of the WebGPU path; the WebGL2 path uses the mean linear colour of each atlas tile (concrete, galvanized metal, woven fabric, honed stone), no normal detail, and the mean of the noise. Floors and atlas materials are flat where WebGPU shows texture.
- Galvanized metal and the brushed sheet use isotropic GGX, so the stretched highlight of WebGPU's anisotropic lobe is missing; the sheet's lighting is a shorter version of the WebGPU sheet shader.
- The shadow lookup's bias is larger (0.00015 + 0.0006 (1 − N·L) against 0.00004 + 0.00028 (1 − N·L)). With the WebGPU bias, a flat floor showed acne bands that WebGPU's textures hide.
- Ropes are expanded on the CPU and surfaces rebuilt on the CPU (`src/webgl/lab-streams.ts`) where WebGPU uses a compute pass and vertex shaders. GPU-cloth strain looks at the 4-neighbourhood and two diagonals (WebGPU: eight neighbours and the nodes two away); water foam uses the cell's own velocity (WebGPU averages the staggered faces). Ropes keep the same limits (4096 nodes and segments).
- The WebGPU renderer's resident GPU water input (`useGpuWater`, which the Lab's frame loop does not use) has no WebGL2 counterpart; water is drawn from the CPU fields.
- Without `EXT_color_buffer_float` the scene targets are RGBA8 and each fragment is tone-mapped where it is drawn: blending happens after tone mapping and there is no bloom. SwiftShader and current desktop browsers have the extension.
- No GPU timestamp queries (`gpuTimingInfo()` reports `unsupported`), no GPU visibility lists or instance partition, and no adaptive-quality GPU sample; the render time shown is CPU time.
- The drawing buffer is preserved (`preserveDrawingBuffer`), so the capture and run-archive buttons can read the canvas outside a frame; this costs a copy per frame on some GPUs.

### Checks

`scripts/lab-webgl2-browser-check.mjs` (not gated; needs `npm run build:pages`, Playwright and Chromium) opens all 15 examples (5 rigid, 10 coupled, including the four with solids) with `?renderer=webgpu` and with `?renderer=webgl2`, steps each to the same tick, requires the same state hash, the same shape plan and own-geometry vertex count, non-blank canvases, and agreement of the two captures (128 × 80 luminance thumbnails: correlation above 0.85, mean difference below 0.08, under 3% of cells differing by more than 0.15), and writes them side by side. It also captures four recipe labs with GPU water, cloth, a cable and a metal sheet on both (no agreement required: they run on wall time), selects a body in the editor on both, checks startup with and without `navigator.gpu`, destroys the WebGPU device mid-run and requires the switch to WebGL2 with the tick, camera and state kept and the run ending on the state hash of a run that never lost its device, loses the WebGL2 context and requires a new one, and requires no console errors. `tests/physics/lab-webgl-streams.test.mjs` and `tests/physics/lab-renderer-selection.test.mjs` (in `npm run test:assets`) test the code without a DOM.

All of this ran in headless Chromium on SwiftShader (software Vulkan for WebGPU, ANGLE on SwiftShader for WebGL2), not on a GPU, not in Safari or Firefox, and not on a phone. Frame times there, a running scene at 672 × 463 drawing pixels at Cinematic quality, median of six seconds: domino-run 16.7 ms with WebGPU and 117 ms with WebGL2 (90th percentile 16.7 and 150 ms); buoy-and-crates 16.7 ms and 150 ms (16.7 and 183 ms). Earlier runs of the same check gave 117 to 150 ms for WebGL2. CPU time in the WebGL2 `render()` call was 0.1 to 0.7 ms. These are software numbers. The WebGL2 frame there is paced by SwiftShader filling the shadow map, the 4× MSAA HDR target and the post pass on the CPU (without shadows and MSAA it measured about 50 ms); the WebGPU canvas on SwiftShader keeps the 60 Hz animation frame. Neither says how a GPU behaves.

## Deliberate boundaries

- Sphere and capsule rows, and hull, mesh, height-field and compound bodies, are drawn only by direct draws. The partition and visibility lists fall back for a frame that has them.
- The Mechanisms SI demo (`src/engine/mechanisms-scene.ts`, `lab.html?si=mechanisms&seed=N`, in the SI entries at the end of the laboratory catalog) has spheres and capsules. Scene files (`lab.html?example=terrain-car`, `lab.html?scene=…`, or a dropped file; see [`SCENE_FORMAT.md`](SCENE_FORMAT.md)) can have every shape kind. None of them is one of the 800 recipes.
- Body meshes are not level-of-detail reduced or frustum-culled, and they have no index buffer: a flat-shaded triangle list repeats each vertex.

- WebGPU reconstructs surface presentation and expands compact rope render state; the numerical solvers remain CPU/WebAssembly work rather than WebGPU compute.
- Water is transparent forward rendering without order-independent transparency.
- Only one active cloth or water surface is drawn per scene.
- Tearing cloth stays on the packed CPU fallback because its topology is mutable.
- Bloom is a compact neighborhood glow rather than a mip-chain implementation.
- Render telemetry is CPU encode/submit time, not physical-GPU timestamp duration.
- The WebGL2 fallback draws the same streams with the differences listed in "WebGL2 fallback (Lab)" above.
