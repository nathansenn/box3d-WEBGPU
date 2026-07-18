# Box3D → Browser/WebGPU Port Architecture

## Authority boundaries

Box3D remains authoritative for rigid-body simulation. The new soft-simulation layer is authoritative for cloth, rope, and water. WebGPU consumes both domains but owns neither solver state.

```text
Box3D world / WASM                         TypeScript soft suite
bodies · hulls · contacts · solver         particles · constraints · water field
              │                                      │
              ├── matrices/colors                    ├── rope matrices/colors
              │                                      ├── cloth indexed surface
              │                                      └── water indexed surface
              └──────────── fixed-step coordinator ─────────────┐
                                                                ↓
                                                          WebGPU renderer
```

This separation keeps the native port stable while allowing deformable/fluid systems to evolve independently or later move to a Worker/WebGPU-compute implementation.

## Browser C ABI

The native bridge exposes scalar calls and contiguous streams:

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

No internal Box3D structures are mirrored in TypeScript.

## Memory-growth safety

Emscripten may replace typed-array views after WebAssembly memory growth. The wrapper exposes `HEAPF32` through a getter, so each synchronization reads the current heap view rather than retaining a detached array.

## Build topology

The browser bridge is the top-level CMake project and includes upstream Box3D with `add_subdirectory`.

This topology:

- avoids inheriting unsuitable top-level Emscripten/pthread policy;
- builds Box3D and the bridge in one graph;
- links the official `box3d::box3d` target;
- enables WebAssembly SIMD without requiring SharedArrayBuffer deployment;
- emits an ES-module factory consumed by `src/physics/wasm.ts`.

## Catalog parity

The TypeScript catalog now contains **750 scenes across 15 families**. The native bridge provides rigid staging for all 15 families, including cloth, rope, and water environments. The actual cloth, rope, and water state is simulated by `SoftSimulationSuite` regardless of whether the rigid backend is Box3D WASM or the deterministic preview backend.

The native bridge varies stress and scene actions and adds cinematic set dressing, but it does not yet claim one-to-one Box3D construction parity for every parameterized recipe.

## Interaction routing

The coordinator sends user/director actions to both active domains:

```text
kick        → rigid broad impulse + cloth/rope disturbance + water displacement
explosion   → Box3D radial impulse + soft radial impulse + water splash
projectile  → Box3D body + cloth puncture / rope severing / water impact floater
rain        → rigid falling bodies + soft impact particles / water droplets
```

This produces synchronized demonstrations without pretending that arbitrary Box3D contacts are already fully bidirectionally coupled into the soft solvers.

## Future native/soft coupling

Recommended next steps:

- shape queries for cloth/rope collision against Box3D hulls;
- force/impulse feedback from floaters and payloads into Box3D bodies;
- joints, motors, sensors, contact events, and shape casts;
- sphere, capsule, mesh, convex-hull, and height-field visual parity;
- worker-based simulation and double-buffered/shared transform streams;
- record/replay files with backend and solver revision metadata;
- WebGPU-compute cloth/rope/water experiments behind the same runtime contract.
