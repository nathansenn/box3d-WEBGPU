# Repository Summary

## Box3D WebGPU AAA Physics Lab v1.13.0

Version 1.13 is the current source-frozen production-optimization release. It
preserves the full hybrid simulation architecture, reconciles the v1.2–v1.12
benchmark history against the production tree, and retains only candidates that
survived current-source correctness, timing, and control gates.

| Area | Delivered |
|---|---|
| Rigid physics | Box3D C17 → Emscripten/WASM bridge plus deterministic preview backend |
| Cloth | PBD particles and constraints; adaptive intact schedules; persistent SIMD/scalar WASM; 12-byte current positions plus immutable rest pose; packed tearing fallback |
| Rope | PBD cables, anchors, payloads, breakage, persistent WASM projection, compact node/segment frames, and WebGPU presentation expansion |
| Water | Deterministic 2.5D shallow-water solver with persistent WASM stepping and GPU-resident surface reconstruction |
| Catalog | 750 deterministic scenes across 15 families |
| Direction | 30 cinematic hero demonstrations and Maximum AAA Tour |
| Rendering | WebGPU instancing, GPU-resident cloth/water, compute-expanded rope, KTX2 BC4/R8, HDR, 1×/4× MSAA, measured shadows, fog, and post-processing |
| Diagnostics | Rigid/soft counts, constraints/cells, breaks, energy, CPU timings, uploads, replay hashes, in-app 750+30 state gate |
| Validation | `validate:v1.13`: 22 Node suites, three soft soaks, exact rope qualification, two-pass native 750-scene soak, Dawn/Metal pipelines and runtime, 1,000-case evidence gate, production and Pages builds |
| Transport | Predictive TurboQuant for remote/network/replay state only; disabled on the local frame path |
| Deployment | Vite production/Pages builds, CI, safe publish scripts, canonical SHA-256 source manifest |

### New in v1.13

- Exact eight-entry MRU native box-hull cache with byte-identical linked WASM.
- Cached preview dynamic-body counts, an exact all-static early return, and
  reset storage reuse.
- Qualified high-count water work, stable native-wrapper stream pointers, and
  numeric renderer configuration caching.
- Current-source requalification of historical compiler modes and a hybrid
  renderer scratch cache; both directions were rejected after failing the
  complete active-path gate.
- A ten-shard registry containing 1,000 unique semantic workloads and 1,000
  unique execution traces, with frozen source, harness, artifact, and renderer
  identities.

The final tournament completed exactly 1,000 cases: **165 accepted wins, 353
borderline changed paths, 360 controls, 85 changed timer-floor cases, 37 no-win
rejections, and 0 correctness failures**. Another 118 controls were below the
22.5 ms timing floor, so 203 total cases are excluded from geometric means. On
Apple M3 Ultra with Node 26, the remaining 555 changed CPU paths measured a
**1.0544× unweighted case-level geometric mean**; 242 controls measured
**1.0041×**. No eligible control met both the `<0.94×` and global BH
`q <= 0.05` material-regression screens. This is not a whole-engine or browser
FPS claim. See
[`docs/V1.13_1000_BENCHMARK_MATRIX.md`](docs/V1.13_1000_BENCHMARK_MATRIX.md).

### Retained performance foundation

- Persistent SIMD and scalar WebAssembly soft kernels with JavaScript fallback.
- GPU-resident intact cloth and shallow water with cached static topology and zero-byte unchanged frames.
- WebGPU compute expansion of compact rope presentation data.
- Coherent longest-axis sweep-and-prune for the preview rigid backend.
- Whole-system cloth/rope projectile rejection before particle contact checks.
- Exact frame/upload caches for rigid, effects, lines, cloth, rope, and water.
- Packed 24-byte tearing surfaces, `uint16` topology, and direct KTX2 BC4/R8 loading.
- Quality profiles that change real MSAA, shadow-map, and PCF work.

The reproducible v1.2-to-v1.10 maximum-detail comparison remains useful
historical context: **7.342× cloth**, **2.746× rope**, and **13.342× water**, or
**6.455× geometric mean**, with zero correctness failures. It does not replace
the current v1.13 matrix, and incremental subsystem ratios are not multiplied
together because their workload sets differ.

### Architectural boundary

Box3D owns rigid-body simulation. Cloth, rope, and water numerical solvers run on CPU JavaScript or CPU WebAssembly. WebGPU reconstructs intact cloth/water presentation and expands compact rope render data; it does not yet run the authoritative soft solvers. Tearing cloth remains on the topology-aware packed path. Water is a heightfield, not a volumetric SPH/FLIP solver.

### Evidence boundary

CPU benchmark ratios are scoped to the named operations and the measured Apple M3 Ultra environment. Dawn/Metal evidence proves shader, pipeline, storage, compute, timestamp-query, upload-cache, and submission behavior on that device. Visible browser acceptance proves interactive operation, not a universal FPS multiplier or a complete browser/driver matrix.
