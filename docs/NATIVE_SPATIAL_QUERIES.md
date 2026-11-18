# Native spatial queries

`NativeWorldBackend.queryBatch()` executes up to 128 spatial queries in one native batch dispatch. Six kinds are available: ray, sphere cast, axis-aligned box cast, sphere overlap, axis-aligned box overlap, and broadphase AABB candidates. This is the spatial-query portion of roadmap item 29; contact events, impulse streams, independently managed shape references, and other collider shapes remain open.

```ts
import { loadNativeWorldPool } from './src/physics/wasm.ts';

const pool = await loadNativeWorldPool();
const world = pool.createWorld();
world.createScene({ id: 0 }, 1, 42);
const [ray, nearby] = world.queryBatch([
  { kind: 'ray', origin: [0, 20, 0], translation: [0, -25, 0], limit: 8 },
  { kind: 'sphere-overlap', origin: [0, 4, 0], radius: 2,
    filter: { bodies: 'dynamic' }, limit: 32 },
]);
for (const hit of ray.hits) {
  const row = world.bodyIndex(hit.body); // null after removal/reset
  if (row !== null) world.applyBodyImpulse(hit.body, 0, 2, 0);
}
pool.destroy();
```

Results are discriminated by `kind`. Cast hits contain an owned `point`, `normal`, `fraction`, material identifier, SDK triangle/child indices, and a world-owned `NativeBodyHandle`. Overlap results contain body references. The bridge currently owns exactly one box collider per body; a triangle or child index is **not** an independently managed shape handle.

## Geometry and filters

Origins and translations are three finite float32-compatible values with absolute components at most 1,000,000. Translation is the complete cast displacement. Box half-extents and sphere radii must be positive and at most 1,000,000. Zero-length casts return no hits. Queries do not step the simulation, apply impulses, or advance transform/color revisions.

The pinned Box3D v0.1.0 source defines shape overlap as distance below `B3_OVERLAP_SLOP`: 0.0005 world units at its default length scale. Consequently, a small positive gap can count as an overlap. AABB candidates use the broadphase's enlarged bounds and can include more distant non-overlapping objects. Neither kind supplies penetration depth or a contact normal.

Casts starting inside the current box colliders report fraction zero, the origin, and a zero normal. Sphere/box casts use the SDK's 0.005 linear slop; they are not analytically exact time-of-impact solvers. A box-edge intersection can have more than one valid entering face normal. The bridge exposes the SDK's chosen face without inventing a smoothed normal.

`filter.bodies` accepts `all`, `static`, `dynamic`, or `none`. Unsigned 64-bit bigint `categoryBits` and `maskBits` default to all bits. The current colliders use the SDK's default all-bit categories/masks. `ignoreBody` must be a live reference from the exact world instance; foreign or stale references reject the entire batch. Per-collider category configuration belongs to later shape/filter work.

## Ordering, limits, and ownership

Each query returns up to `limit` hits, from 1 through 256; the default is 32. `totalHits` counts every matching collider, including hits omitted by truncation. `overflow` is true exactly when `totalHits` exceeds the returned count. Casts sort by fraction, body token, triangle, then child; overlaps sort by body token. A bounded max-heap retains the best K results throughout traversal, so truncation cannot discard a closer hit just because the collision tree visited it later. Counting all hits intentionally prevents early termination after finding a nearest hit.

All JavaScript results are owned copies. They survive another batch, module heap growth, scene reset and world destruction. Body references still become stale when their bodies disappear. The TypeScript `readonly` result contract does not make JavaScript arrays immutable. Do not keep dense render rows as body identity.

Inputs are completely validated before reservation or staging. Every execution makes one `_b3w_world_query_batch` call; reservation and metadata access still make a small fixed number of bridge calls, and unique ignored-body references require liveness lookups. This is not a claim that the complete adapter uses only one export call. No per-hit JavaScript callback or native lookup is required to return the batch.

The arena starts unallocated. Input tiers are 16/64/128 and hit tiers are 64/512/4,096/32,768. Storage is `inputs × 96 + hits × 56` bytes, with a maximum of **1,847,296 bytes per querying world**, separate from body storage. It grows transactionally and stays reserved until world destruction. Failed allocation leaves the old arena and physics intact. `spatialQueryInfo()` exposes support, limits, bytes and revision. An exhausted uint32 query revision retires the query path rather than wrapping; create a new world to resume queries. Worlds that never query allocate no query arena.

The optional ABI extension requires all seven query exports plus all body-lifecycle exports. Earlier world artifacts remain usable for their existing operations and explicitly reject query calls. The compatibility world's original API is unchanged. Raw C body tokens are scoped by their world handle; TypeScript ownership guards also reject equal-valued tokens from another world.

## Validation

The accepted frozen geometry run is `benchmarks/results/engine-100x/runs/native-queries-geometry-20260910-04/`. It compares 5,888 queries and 15,292 hits in 4K, 16K, 64K and rotated-body scenes with an independent scalar reference. Rays use slab intersection; spheres use closest-point distance; boxes use separating axes plus vertex/face/edge distances near the SDK overlap threshold. Body matches and batch-versus-serial output are exact. Maximum errors are 5.421e-7 in fraction, 2.079e-5 in position, and 3.378e-8 in normal components. Six intersections have multiple valid incident normals within the existing 3e-4 position envelope.

Run 01 failed its initial zero-slop overlap assumption. Runs 02/03 failed an assumption that float32 and float64 must choose the same face at an edge. These runs remain unchanged. Run 04 declares the SDK overlap rule and incident-face normal rule in advance, retains complete observed/reference hits, and keeps the original numerical thresholds. Its independent checker rehashes inputs and recomputes hit geometry, metadata and numerical errors. The frozen execution additionally checks all possible target boxes for missing hits; the read-only checker does not rerun native physics.

The focused suite covers all six kinds, initial/zero-length casts, uint64 filters, nearest-K truncation across 300 bodies, ties, removal/slot reuse, all 128 inputs and 32,768 output slots, stale/foreign references, heap relocation, scene/world lifetime, corrupt native outputs, and 68 cycles of largest-arena world churn. Two more tests use a separate artifact to inject allocation failure and revision exhaustion; those exports are absent from production.

The new native artifact also preserves all 20,800 recorded catalog comparisons and 1,920 interleaved comparisons across 16 worlds. Two independent builds produce byte-identical JS/WASM. The browser probe exercises all query kinds, 128-query equivalence, deletion/compaction, stepping, reset and a second camera. These checks qualify functionality and bounded storage, **not query throughput, application FPS, or an engine-wide 100× improvement**.

```sh
node --test tests/engine/native-queries.test.mjs
node --test tests/qualification/native-query-*.test.mjs
node scripts/native-query-check.mjs --run benchmarks/results/engine-100x/runs/native-queries-geometry-20260910-04
```

The development probe is `/benchmarks/experiments/native-query-probe.html`. It is excluded from the Studio production build. Existing applications can continue using the previous APIs; query results are available to consumers that opt into `queryBatch()`.
