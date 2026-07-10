# Rendering Pipeline

## Frame graph

```text
CPU / WASM
  Box3D fixed step
  transform + color stream
  cinematic effect generation
          │
          ├── Pass 1: directional shadow depth (2048² depth32float)
          │       instanced cubes, front-face culling
          │
          ├── Pass 2: HDR scene (rgba16float, 4× MSAA)
          │       atmospheric sky
          │       instanced PBR-inspired solids
          │       additive debug/effect lines
          │       resolve to single-sample HDR texture
          │
          └── Pass 3: post processing to swapchain
                  neighborhood glow
                  exposure
                  ACES-inspired tone map
                  vignette
                  film grain
                  display gamma
```

## Instance layout

Every body uses:

- 16 floats for its column-major model matrix;
- 4 floats for base color and material tag;
- one shared 36-vertex cube mesh.

The color alpha channel is repurposed as a material tag:

```text
alpha = 1     ordinary material
alpha > 1     emissive strength
```

This avoids a second material buffer while remaining compatible with the native C transform/color stream.

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

| Profile | Resolution | Shadows | Effects | Intended use |
|---|---:|---:|---:|---|
| Performance | 70% | skipped | 256 | low-power/mobile diagnostics |
| Balanced | 85% | 68% | 512 | general interaction |
| Cinematic | 100% | full | 1,024 | default capture quality |
| Ultra | 115% | full | 1,536 | high-end screenshot/demo capture |

Resolution is multiplied by browser device pixel ratio and capped at 2×.

## Shader validation

`GPUShaderModule.getCompilationInfo()` is used when the browser exposes it. Compilation errors are promoted into startup failures with line and column information instead of allowing a silent invalid pipeline.

## Deliberate simplifications

- The current bloom is a compact neighborhood glow, not a production mip-chain bloom.
- Ambient occlusion is a height/normal proxy, not GTAO/SSAO.
- Materials are inferred from color characteristics instead of using texture sets.
- Lighting uses one directional key light plus procedural ambient terms.
- Render telemetry measures CPU-side encoding/submission, not GPU timestamp-query duration.
