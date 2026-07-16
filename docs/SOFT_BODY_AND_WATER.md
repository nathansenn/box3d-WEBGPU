# Cloth, Rope, and Water Architecture

## Runtime overview

Version 1.9 keeps Box3D as rigid-body authority and semantically adds the supplied adaptive-cloth and compact-rope rendering changes to the reconstructed v1.8.1 runtime:

```text
Box3D WASM / rigid preview                  SoftSimulationSuite
rigid-body authority                       scene and action authority
        │                                           │
        │                                  SIMD WebAssembly
        │                                      ↓ fallback
        │                                  scalar WebAssembly
        │                                      ↓ fallback
        │                                  JavaScript kernels
        │                                           │
        └──────────── fixed-step coordinator ───────┘
                                  │
             solver-native states + compact render streams
                                  ↓
       WebGPU cloth/water reconstruction + rope expansion
```

The v1.8.1 implementation was reconstructed from the architecture described in the prior project conversation using the verified v1.4.1 source present in this workspace. The later supplied v1.9 archive verifies as SHA-256 `09fa0eec3db1858d57cdc58a9fe8f021b76cd6c19c5b8913eb9d55e1667a1fbb`, but it descends from a different original-v1.8.0 source line. Its behavior was manually ported rather than used to replace the repository. See [`INTEGRATION_V1.9.md`](INTEGRATION_V1.9.md). The current optimized target is v1.13 and is covered by [`V1.13_1000_BENCHMARK_MATRIX.md`](V1.13_1000_BENCHMARK_MATRIX.md); the v1.12/v1.11 audits and v1.10 integration map remain historical attribution evidence.

## Soft-kernel WebAssembly runtime

`wasm/soft_kernels.c` is a standalone C17 module with no host imports. `scripts/build-soft-kernels.sh` creates two deterministic artifacts:

```text
public/soft-kernels-simd.wasm
public/soft-kernels-scalar.wasm
```

The loader in `src/soft/kernels.ts` attempts SIMD first, then scalar WASM, then leaves the existing JavaScript path active. A missing or rejected module does not block application startup.

The module exposes:

- intact-cloth constraint projection;
- rope constraint projection and controlled breaking;
- linear shallow-water field stepping;
- the retained rope segment matrix/tension-color ABI from the v1.8.1 reconstruction;
- a simple ABI/version probe and aligned arena allocator.

Simulation arrays are copied into a persistent WebAssembly arena when a compatible scene is created. Typed views are refreshed from exported memory, so the hot numerical kernels do not require a new allocation every frame. The v1.9 steady rope-render path publishes compact node/segment state and performs matrix/color expansion in WebGPU; the older builder remains part of the preserved ABI rather than being substituted with the archive's loader.

### Correctness boundaries

- Tearing cloth stays on the mutable JavaScript topology path.
- Live cloth projectile interaction can use the JavaScript path while contacts are active.
- Rope projectile contact selection and break bookkeeping remain coordinated in TypeScript.
- The WebAssembly module accelerates selected kernels; the rope compute pass expands render data only. Neither mechanism replaces Box3D or moves numerical soft physics onto WebGPU.

## Shared frame contract

Every active system publishes a `SoftSimulationFrame`:

| Field | Purpose |
|---|---|
| `kind` / `label` | active solver and human-readable configuration |
| `matrices` / `colors` | payloads, projectiles, droplets, floaters, and other shared instances |
| `surface` | `gpu-cloth`, `gpu-water`, packed tearing cloth, or `null` |
| `ropeGrid` | compact rope node positions and active segment metadata, or `null` |
| `debugLines` | pins, constraints, sample nodes, and current vectors |
| `nodeCount` | particles/cells plus transient objects |
| `constraintCount` | PBD links or water relationships |
| `brokenCount` | torn cloth links or broken rope segments |
| `energy` | normalized diagnostic |
| `hash` | quantized deterministic replay signature |
| `frameVersion` | monotonic version used to skip repeated frame work and uploads |

Hard budgets remain explicit:

```text
soft instances                 2,048
water droplets                   768
surface vertices              16,384
surface indices               98,304
```

`buildFrame()` memoizes the complete frame for a matching `frameVersion` and debug state. The renderer separately caches surface state, topology, and soft-instance streams.

## Cloth

### Numerical model

Cloth uses deterministic position-based dynamics:

1. Verlet-style integration derives velocity from current and previous positions.
2. Gravity and deterministic wind/turbulence are applied.
3. Structural, shear, and bend constraints project positions toward rest lengths.
4. Ground and optional sphere collisions project penetrating particles outward.
5. Projectiles and rain proxies transfer momentum.
6. Breakable constraints are evaluated against controlled stretch thresholds.
7. Strain, energy, hash, and frame version are updated.

Before particle-level projectile checks, the solver computes a whole-system AABB and rejects distant projectiles. Surviving candidates use squared distance before exact response work.

Intact cloth can use the persistent WebAssembly projection kernel. Structural tearing scenes retain JavaScript projection because they mutate break maps and triangle topology.

Intact projection uses scene-structural ceilings with compensated per-pass stiffness:

```text
variant 9 · perimeter-pinned membrane drum     4 passes
variant 3 · hammock / collider drape           6 passes
other intact cloth                             8 passes maximum
tearing cloth                                  full authoritative schedule
```

The current soft-kernel ABI projects one compact constraint stream. The manual port preserves that ABI; it does not import the supplied archive's loader or memory ownership model.

### GPU-resident intact presentation

An intact cloth frame publishes:

```text
path: gpu-cloth
positions: float32 xyz · changed-frame stream
restPositions: float32 xyz · immutable rest pose
topology: uint16 indices
grid: cols × rows
two material palettes
```

Changed-frame dynamic traffic is 12 bytes per vertex. The immutable rest pose is uploaded only when its buffer identity or topology version changes. WebGPU derives visual strain from current/rest geometry and reconstructs normal, UV, checker parity, palette color, stress heat, woven response, world position, and shadow position. The legacy strain array remains available for diagnostics and tearing compatibility but is not part of the intact steady upload.

### Topology-aware tear fallback

The solver records horizontal and vertical break maps. Triangles spanning broken links are omitted, producing visible holes rather than merely recoloring an intact mesh. Because disconnected triangles invalidate simple grid-neighbor reconstruction, tearing cloth uses the 24-byte packed surface path with CPU-generated topology-aware normals.

## Rope and rigging

Rope uses deterministic Verlet/PBD chains with distance and bend constraints, fixed anchors, optional payloads, cross-links, break thresholds, and projectile interaction.

Rope uses the same whole-system AABB rejection before particle/constraint contact work.

During simulation:

- projection operates over persistent structure-of-arrays constraint buffers;
- TypeScript coordinates projectile contact selection, breaking, payloads, and debug diagnostics;
- an active render segment is published as eight float32 words: two node indices, inverse rest length, radius, and RGBA;
- node positions are the changed-frame stream, while segment metadata is refreshed only when topology changes;
- a WebGPU compute pass expands compact nodes/segments into the shared model-matrix and material buffers.

The compute expansion uses raw endpoint distance for tension and a clamped distance only for constructing a stable orientation. That distinction prevents zero-length connectors from appearing maximally overstressed. This is render preparation, not a GPU rope solver.

## Shallow water

Water is a deterministic 2.5D linear shallow-water heightfield. Each cell tracks:

```text
eta   surface-height displacement
u     horizontal X velocity
v     horizontal Z velocity
```

The stable kernel updates velocity from gradients, applies drag, updates height from divergence, and reflects flow at the boundary. It can execute in SIMD WASM, scalar WASM, or JavaScript.

The render frame publishes `eta/u/v` directly at 12 bytes per cell. The GPU reconstructs grid position, height, normal, curvature, current-derived foam, UV, and material response. Static `uint16` topology is reused.

This remains a heightfield for basins, wakes, ripples, impacts, and currents—not volumetric SPH, FLIP, or arbitrary-topology water.

## Caching and state changes

Actions and numerical steps increment `frameVersion`; a read-only request does not. This enables exact work elimination for:

- repeated `buildFrame()` calls;
- unchanged cloth/water storage uploads;
- unchanged rope node uploads and segment-topology uploads;
- unchanged soft instance uploads;
- unchanged topology uploads.

The cache is an optimization only. A changed version still validates counts, stream lengths, finite state, and index bounds before submission.

## Determinism

Every system is seeded by scene identity and a caller-provided seed. Replay hashes quantize a bounded subset of simulation state before FNV-style accumulation. Tests create the same SIMD-backed scene twice, apply the same action schedule, and require the same hash.

Hashes are regression signals, not cryptographic digests or promises of cross-version bit identity.

## Validation

Run the focused gates:

```bash
npm run test:soft-kernels
npm run test:soft-soak
npm run test:soft-soak:wasm
npm run test:webgpu
```

They cover:

- deterministic SIMD/scalar rebuilds and ABI markers;
- SIMD preference, scalar fallback, and JavaScript fallback;
- cloth, rope, and water numerical kernels plus compact rope render expansion;
- real cloth/rope/water scene integration and deterministic replay;
- all 150 soft/fluid scene constructors and action schedules;
- finite solver-native and packed surface streams;
- `gpu-cloth`/`gpu-water`/`ropeGrid` contracts and topology bounds;
- WGSL cloth/water reconstruction, GPU rope compute, and complete Dawn frame submission;
- 12-byte changed-frame cloth and 12-byte water upload accounting;
- zero additional upload bytes for repeated unchanged surface, rope-grid, and soft-instance frames.

The complete gate is:

```bash
npm run validate:v1.13
```

This is the current cross-platform integration gate. Metal-only timestamp and KTX2 sampling checks run separately with `npm run validate:hardware`; neither gate establishes universal browser FPS.

## Remaining engineering frontiers

1. Bidirectional collision coupling against arbitrary Box3D shapes.
2. Cloth/rope self-collision and continuous collision.
3. XPBD compliance and physically calibrated material parameters.
4. WebGPU compute physics solvers, GPU collision compaction, and indirect drawing; current rope compute is render expansion only.
5. Multiple simultaneous cloth/water surface batches.
6. Physical-GPU timestamp profiling on target browsers.
