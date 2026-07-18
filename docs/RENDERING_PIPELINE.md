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
  instanced rigid/rope/effect geometry
  intact GPU-cloth shadow reconstruction
  packed tearing-cloth shadow fallback
                                                       ↓
Pass 2: HDR scene (rgba16float, 4× MSAA)
  atmosphere and sky
  instanced PBR solids
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
| PBR solid | instanced cubes | GGX-inspired light, shadowing, emissive tag, fog |
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

## Deliberate boundaries

- WebGPU reconstructs surface presentation and expands compact rope render state; the numerical solvers remain CPU/WebAssembly work rather than WebGPU compute.
- Water is transparent forward rendering without order-independent transparency.
- Only one active cloth or water surface is drawn per scene.
- Tearing cloth stays on the packed CPU fallback because its topology is mutable.
- Bloom is a compact neighborhood glow rather than a mip-chain implementation.
- Render telemetry is CPU encode/submit time, not physical-GPU timestamp duration.
