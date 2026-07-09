# WebGPU Port Plan — Maximum Lab

## Current architecture

```text
Box3D C17 → Emscripten/WASM bridge → TypeScript backend wrapper → WebGPU renderer
```

The port keeps Box3D upstream intact and replaces the sample/viewer layer with a browser-native WebGPU application.

## Completed in this package

- WebGPU canvas renderer.
- Instanced cube rendering.
- Debug line overlay.
- WASM bridge loader.
- C ABI bridge for demo-facing Box3D features.
- JS fallback physics backend.
- 600-scene procedural catalog.
- Search/filter/select scene browser.
- Max Tour showcase mode.
- Automated Node tests and browser tests.

## Next engineering milestones

1. **Worker backend**
   - Move physics step into a Worker.
   - Use SharedArrayBuffer where browser security headers allow.
   - Keep render loop smooth under high stress.

2. **Native scene parity**
   - Expand `wasm/box3d_web.c` so each of the 600 variants has a full native Box3D recipe.
   - Add more primitive types if upstream Box3D supports them cleanly.

3. **Debug draw parity**
   - Contacts.
   - Normals.
   - AABBs.
   - Body sleep/island state.
   - Joint constraints.

4. **GPU compute experiments**
   - Generate AABBs from transforms.
   - Broadphase candidate visualization.
   - GPU particle/debris systems alongside rigid bodies.

5. **Production-grade rendering**
   - Mesh instances instead of cube-only display.
   - Materials and lighting presets.
   - Shadow maps.
   - Camera bookmarks and cinematic capture mode.
