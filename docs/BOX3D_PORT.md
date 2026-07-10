# Box3D → Browser/WebGPU Port Architecture

## Boundary decision

Box3D remains authoritative for simulation. WebGPU consumes transform and material streams but does not own rigid-body state.

```text
Box3D world
  bodies / hulls / contacts / solver
           ↓ b3w_sync_transforms()
contiguous float arrays in WASM memory
  modelMatrix[bodyCount × 16]
  color[bodyCount × 4]
           ↓ queue.writeBuffer()
WebGPU instance buffers
```

This separation minimizes port risk and makes future renderer or worker changes independent of the solver.

## Browser C ABI

The bridge exposes only stable scalar calls and pointers:

```text
b3w_create_scene
b3w_destroy
b3w_step
b3w_sync_transforms
b3w_body_count
b3w_dynamic_count
b3w_matrices_ptr
b3w_colors_ptr
b3w_max_bodies
b3w_kick_stack
b3w_explode
b3w_launch_projectile
b3w_spawn_rain
b3w_replay_hash
```

No Box3D internal structure is mirrored in TypeScript.

## Memory growth safety

Emscripten may replace typed-array views after WebAssembly memory grows. The WASM wrapper therefore exposes `HEAPF32` through a getter rather than retaining the array created at module startup.

## Build topology

The browser bridge is the top-level CMake project. Upstream Box3D is included with `add_subdirectory`.

Why:

- avoids accidental top-level Emscripten pthread requirements;
- keeps the bridge and library in one dependency graph;
- preserves the official `box3d::box3d` target;
- permits WebAssembly SIMD without requiring SharedArrayBuffer deployment headers;
- generates the final ES module directly.

## Scene parity

The TypeScript catalog contains 600 recipes. The native bridge currently maps each of 12 families to a native recipe and varies stress/variant actions. Cinematic and Maximum modes also receive native set dressing. Full one-to-one native parity remains an extensible milestone rather than being falsely claimed complete.

## Future native API coverage

Recommended additions:

- sphere, capsule, convex hull, mesh, and height-field visual parity;
- joints and motors;
- sensors and contact events;
- ray casts, shape casts, overlap queries;
- character mover;
- recording/replay export;
- debug draw callbacks and shape-lifetime GPU resources;
- worker-based simulation and shared/double-buffered transforms.
