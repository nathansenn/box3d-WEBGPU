# Studio packed solver state

Fresh Studio UI runs now select the [qualified compensated-norm mode](STUDIO_NORM3.md), which retains object storage. The storage experiments and memory figures below predate that numerical mode; the legacy API default and packed experiment keep their original backend.

The default `FailureSimulation` retains its object solver. It now clears the temporary endpoint lookup after constructing faces and dependencies. A separate `PackedFailureSimulation` experiment is available through `src/engine/index.ts`. It is **not selected by the Studio runtime or worker**, because both paired CPU comparisons failed the performance gate.

The experimental solver owns stable typed buffers for particle and constraint state. Particle positions, previous positions, rest coordinates, inverse mass and strain use Float64. Constraint lengths, stiffness, thresholds, damage and plastic strain also use Float64. Endpoints use Uint32; kind and broken flags use Uint8. These choices preserve the previous JavaScript Number arithmetic; render snapshots still explicitly copy to Float32.

The twelve projection iterations retain their original alternating traversal, stable constraint IDs, dependency order, and coordinate update order. Active constraints compact only at iteration boundaries. Contact still updates particles and the press ram sequentially. No timestep, iteration count, constitutive rule, failure threshold, or checkpoint backend identity changes.

The experimental particle/constraint buffers and active-ID buffer total 391,384 bytes for canopy, 421,124 bytes for plate and 33,298 bytes for bridge. These are numeric-buffer byte counts, **not total heap use or an allocation-rate measurement**. Faces, supports, events and dependency lists remain JavaScript arrays. Constructor link objects are discarded after packing. The existing small dependency lists remain directly editable; they are not copied during stepping.

## Compatibility and ownership

The experimental solver's `nodes` and `links` are lazy, stable arrays of live compatibility views. Indexed particle-vector writes, inverse-mass changes, link parameter changes and dependency-list edits reach the canonical solver state immediately. Vectors remain ordinary arrays for JSON serialization and existing consumers. Assigning a vector copies its three values into the stable view; it does not transfer ownership of the caller's array. Existing references to views observe both later steps and checkpoint restoration. Accessors are shared across views, and vector views are created only when read.

The authored scene has fixed node/link counts. Adding or removing nodes, links, or vector components is not supported. Use the constructor to create a specimen and validated checkpoints to restore it. `nodeCount` and `linkCount` provide counts without creating compatibility objects. The experimental step, snapshot, response, active-topology and checkpoint paths operate directly on numeric stores, without materializing these views.

Public compatibility views trade some construction memory for the existing editable object interface. They are not the packed kernel's intended traversal API. Consumers that only need live rendering should use `createSnapshotTarget()` / `snapshotInto()`, and durable state should use `exportCheckpoint()`.

## Checkpoints and numerical evidence

Checkpoints remain full-precision, independent, JSON-safe objects with backend `studio-pbd-js-v1`. Validation completes before any receiver state changes. Restore writes existing buffers, so retained public views stay attached and the worker keeps its storage ownership. No display snapshot is treated as a resumable checkpoint.

The 22 frozen-original scenarios compare every particle, link and event exactly for both default and experimental solvers, including twenty press experiments, canopy and bridge. The new storage suite also compares three edited full-precision trajectories against the solver captured immediately before packing, tests JSON/structured-clone output and restoration, and rejects any compatibility-object access by the experimental hot paths. The existing checkpoint/corruption/active-constraint tests continue to apply.

The preceding source is preserved in `benchmarks/baselines/studio-before-typed-arrays-20260910/`; its manifest identifies the complete snapshot. Both `studio-typed-arrays-20260910-01/` and `-02/` retained complete six-pair, nine-case timing runs. The first failed broadly. The refined second candidate preserved exact trajectories but still regressed p95 in canopy with four instances and bridge with one/two instances; its unchanged control interval was also too wide. Neither establishes a speed gain. The default solver was restored before applying its separate construction-index cleanup.

## Retained-memory measurements

`scripts/studio-storage-memory.mjs` runs four balanced pairs per study/mode in fresh Node processes. Each process warms two instances, creates eight instances, advances each sixteen fixed ticks, then measures `heapUsed + arrayBuffers` after three explicit garbage collections. It keeps all eight instances alive through the sample, and hashes full-precision checkpoints afterward. Source, harness, runtime and raw outputs are retained. The numbers below are the median retained bytes divided by eight, not process RSS, live browser memory, or bytes allocated per step.

| Study | Original, no views | Packed, no views | Original, all views | Packed, all views |
| --- | ---: | ---: | ---: | ---: |
| Canopy | 2,030,658 | 987,402 | 2,031,243 | 2,586,218 |
| Plate | 2,178,310 | 1,063,375 | 2,179,745 | 2,818,050 |
| Bridge | 139,651 | 55,846 | 140,973 | 263,785 |

The packed path retained about 51–60% less state without views, and 27–87% more with all views requested. This is a capacity tradeoff worth retaining for future packed-buffer integrations; it does not override the failed timing gate. Results: `studio-typed-memory-20260910-01/`.

A separate experiment, `studio-index-memory-20260910-01/`, measured only the construction-index cleanup in the default object solver. Median retained bytes per instance fell from 2,030,643 to 1,786,254 for canopy, 2,178,171 to 1,932,762 for plate, and 139,656 to 124,427 for bridge: **12.0%, 11.3%, and 10.9%** respectively in the mode without compatibility traversal. Full object traversal gave similar reductions. The source at `benchmarks/baselines/studio-object-index-cleanup-20260910/` captures this final default and the explicit experimental API.

The packed memory experiment includes its own removal of that construction index, so its full reduction cannot be attributed solely to typed arrays. Neither memory experiment measures an allocation rate or promises browser frame improvements.
